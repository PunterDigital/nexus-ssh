// ============================================================
// Nexus SSH Client — Local Filesystem IPC Handlers
// Exposes a minimal read-only filesystem API for the SFTP
// browser's local pane.
// ============================================================

import { ipcMain, app, shell, dialog, BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IPC, VAULT_DEFAULT_DIR_NAME } from '../../shared/constants';

/**
 * Resolve the active vault directory, honouring the user's configured path
 * from app_meta (setting:defaultVaultPath) and falling back to the platform
 * default under userData.
 */
export async function resolveVaultDir(): Promise<string> {
  // Try to read the configured path from the open vault's app_meta
  try {
    const { vaultEngine } = require('../vault/index');
    if (vaultEngine.isUnlocked()) {
      const db = vaultEngine.getDb();
      const row = await new Promise<{ value: string } | undefined>((resolve) => {
        db.get(
          `SELECT value FROM app_meta WHERE key = ?`,
          ['setting:defaultVaultPath'],
          (_err: unknown, r: unknown) => resolve(r as { value: string } | undefined),
        );
      });
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value);
          if (typeof parsed === 'string' && parsed.trim()) return parsed;
        } catch {
          if (typeof row.value === 'string' && row.value.trim()) return row.value;
        }
      }
    }
  } catch {
    // ignore — fall through to default
  }
  return path.join(app.getPath('userData'), VAULT_DEFAULT_DIR_NAME);
}

/** Sentinel path used to represent "list all drives" on Windows. */
export const DRIVES_ROOT = '__drives__';

function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

export interface LocalFSEntry {
  filename: string;
  longname: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modifyTime: number;
  accessTime: number;
  permissions: number;
  owner: number;
  group: number;
}

function formatLongname(name: string, stat: { isDirectory: () => boolean; size: number; mtime: Date }): string {
  const type = stat.isDirectory() ? 'd' : '-';
  const date = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
  return `${type}rwxr-xr-x 1 user group ${String(stat.size).padStart(10)} ${date} ${name}`;
}

async function listDrives(): Promise<LocalFSEntry[]> {
  if (process.platform !== 'win32') {
    // On Unix, the root is just '/'
    return [];
  }
  const drives: LocalFSEntry[] = [];
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    const letter = String.fromCharCode(code);
    const driveRoot = `${letter}:\\`;
    try {
      const stat = await fs.stat(driveRoot);
      if (stat.isDirectory()) {
        drives.push({
          filename: `${letter}:`,
          longname: `drwxr-xr-x 1 user group          0 - ${letter}:`,
          isDirectory: true,
          isSymlink: false,
          size: 0,
          modifyTime: Math.floor(stat.mtimeMs / 1000),
          accessTime: Math.floor(stat.atimeMs / 1000),
          permissions: stat.mode,
          owner: 0,
          group: 0,
        });
      }
    } catch {
      // Drive not present
    }
  }
  return drives;
}

export function registerFsHandlers(): void {
  // List a directory on the local filesystem
  ipcMain.handle(IPC.FS_LIST, async (_event, dirPath: string) => {
    try {
      // Special case: drives listing (Windows "This PC")
      if (dirPath === DRIVES_ROOT || dirPath === '' || dirPath === 'Computer') {
        if (process.platform === 'win32') {
          return ok(await listDrives());
        }
        // On non-Windows, drives root is just '/'
        dirPath = '/';
      }

      const resolved = path.resolve(dirPath);
      const entries = await fs.readdir(resolved, { withFileTypes: true });

      const results: LocalFSEntry[] = [];
      for (const entry of entries) {
        const fullPath = path.join(resolved, entry.name);
        try {
          const stat = await fs.lstat(fullPath);
          results.push({
            filename: entry.name,
            longname: formatLongname(entry.name, {
              isDirectory: () => stat.isDirectory(),
              size: stat.size,
              mtime: stat.mtime,
            }),
            isDirectory: stat.isDirectory(),
            isSymlink: stat.isSymbolicLink(),
            size: stat.size,
            modifyTime: Math.floor(stat.mtimeMs / 1000),
            accessTime: Math.floor(stat.atimeMs / 1000),
            permissions: stat.mode,
            owner: stat.uid ?? 0,
            group: stat.gid ?? 0,
          });
        } catch {
          // Skip entries that can't be stat'd (permission denied, etc.)
        }
      }

      return ok(results);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // Return the user's home directory
  ipcMain.handle(IPC.FS_HOME, async () => {
    try {
      return ok(app.getPath('home') || os.homedir());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // Open the configured vault directory in the OS file explorer
  ipcMain.handle(IPC.FS_OPEN_VAULT_DIR, async () => {
    try {
      const dir = await resolveVaultDir();
      await fs.mkdir(dir, { recursive: true });
      await shell.openPath(dir);
      return ok(dir);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // Show a native directory picker and return the selected path
  ipcMain.handle(IPC.FS_PICK_DIRECTORY, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const result = win
        ? await dialog.showOpenDialog(win, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select vault directory',
          })
        : await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select vault directory',
          });

      if (result.canceled || result.filePaths.length === 0) {
        return ok(null);
      }
      return ok(result.filePaths[0]);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // Show a native file picker and return the selected path(s)
  ipcMain.handle(
    IPC.FS_PICK_FILE,
    async (
      event,
      options?: {
        title?: string;
        filters?: { name: string; extensions: string[] }[];
      },
    ) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
        const dialogOpts = {
          properties: ['openFile' as const],
          title: options?.title ?? 'Select file',
          filters: options?.filters,
        };
        const result = win
          ? await dialog.showOpenDialog(win, dialogOpts)
          : await dialog.showOpenDialog(dialogOpts);
        return ok({ filePaths: result.filePaths, canceled: result.canceled });
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
