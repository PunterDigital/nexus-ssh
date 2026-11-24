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
import { listDrives, listLocalDir } from '../fs/local-list';

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

export type { LocalFSEntry } from '../fs/local-list';

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

      // Stats run in parallel, a bounded number at once (#5667)
      return ok(await listLocalDir(dirPath));
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
