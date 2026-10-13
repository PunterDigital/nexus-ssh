import {
  app,
  BrowserWindow,
  session,
} from 'electron';
import http from 'http';
import { promises as fsp, createReadStream } from 'fs';
import path from 'path';
import { registerAllHandlers } from './ipc/index';
import { initSodium } from './kdf';
import { vaultEngine } from './vault/index';
import { sshManager } from './ssh/index';
import { sftpManager } from './sftp/index';
import { syncEngine } from './sync/engine';
import { securityManager } from './security';
import { getCSPHeader } from './security/csp';

let mainWindow: BrowserWindow | null = null;
let localServer: http.Server | null = null;
let rendererOrigin: string | null = null;

// E2E tests run the unpackaged app against the built renderer, with an isolated profile.
const isDev = !app.isPackaged && process.env.NEXUS_USE_BUILT_RENDERER !== '1';
if (process.env.NEXUS_USER_DATA_DIR) {
  app.setPath('userData', process.env.NEXUS_USER_DATA_DIR);
}

// WebAuthn (used for hardware-key vault unlock) requires the renderer's
// origin to be HTTPS-with-valid-cert, "localhost" HTTP, or an extension page.
// Custom protocol schemes — even those marked secure: true — do NOT satisfy
// Chromium's WebAuthn origin check. We therefore serve the production
// renderer from a loopback-only HTTP server bound to 127.0.0.1 on an
// OS-assigned ephemeral port. The WebAuthn RP ID becomes "localhost".
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

async function startRendererServer(): Promise<string> {
  const rendererRoot = path.resolve(__dirname, '..', 'renderer');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const requestedPath = decodeURIComponent(
        url.pathname === '/' ? '/index.html' : url.pathname,
      );
      const filePath = path.normalize(path.join(rendererRoot, requestedPath));
      if (!filePath.startsWith(rendererRoot)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.writeHead(404).end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
        'Content-Length': stat.size,
      });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500).end('Internal Server Error');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind renderer server');
  }
  localServer = server;
  return `http://localhost:${address.port}`;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Nexus',
    show: false,
    backgroundColor: '#1a1b2e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  // Set Content-Security-Policy headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [getCSPHeader()],
      },
    });
  });

  // Prevent new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Prevent navigation away from the app
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Load the renderer
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (rendererOrigin) {
    mainWindow.loadURL(`${rendererOrigin}/index.html`);
  }

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register all IPC handlers
function setupIPC(): void {
  registerAllHandlers();
}

// Security manager handles power-monitor events (suspend/lock → vault lock,
// resume/unlock → idle timer reset) as well as idle-timeout auto-lock.
// The renderer is notified via 'security:vault-locked' when the vault is locked.

// App lifecycle
app.whenReady().then(async () => {
  // Initialise libsodium before anything else
  await initSodium();

  // Start the loopback renderer server so the production renderer is served
  // from a "localhost" origin (required by WebAuthn for hardware-key unlock).
  if (!isDev) {
    rendererOrigin = await startRendererServer();
  }

  // Register IPC handlers (must happen before windows send invoke calls)
  setupIPC();

  // Create the main window
  createWindow();

  // Wire singletons to the main window for IPC push events
  if (mainWindow) {
    sshManager.setMainWindow(mainWindow);
    sftpManager.setMainWindow(mainWindow);
    syncEngine.setMainWindow(mainWindow);
    securityManager.setMainWindow(mainWindow);
  }

  // Initialise security monitoring (idle auto-lock, power-monitor listeners)
  securityManager.init();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Cleanup on quit — destroy vault, SSH sessions, SFTP, sync, and security
app.on('before-quit', async () => {
  securityManager.destroy();
  syncEngine.stopAutoSync();
  try {
    await syncEngine.disconnect();
  } catch {
    // Best-effort cleanup
  }
  sftpManager.destroyAll();
  sshManager.destroyAll();
  vaultEngine.destroy();
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});

// Security: prevent additional webContents creation
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});
