// ============================================================
// Nexus SSH Client — Settings IPC Handlers
// Stores settings in the app_meta table of the encrypted vault.
// ============================================================

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/constants';
import { vaultEngine } from '../vault/index';
import type { NexusSettings } from '../../shared/types';

/** Wrap a handler result in a standardised envelope. */
function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

// ---------------------------------------------------------------------------
// Internal helpers to read/write settings via the app_meta table
// ---------------------------------------------------------------------------

const SETTINGS_KEY_PREFIX = 'setting:';

/** Default settings. */
const DEFAULTS: NexusSettings = {
  autoLockTimeout: 15,
  clipboardClearTimeout: 30,
  theme: 'dark',
  terminalFont: 'JetBrains Mono',
  terminalFontSize: 14,
  scrollbackLines: 10000,
  sftpConcurrency: 3,
  gpuAcceleration: true,
  showHiddenFiles: false,
  defaultVaultPath: '',
};

function dbRun(sql: string, params: unknown[] = []): Promise<void> {
  const db = vaultEngine.getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function dbGet<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const db = vaultEngine.getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: T) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = vaultEngine.getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows ?? []);
    });
  });
}

async function getSetting(key: string): Promise<unknown> {
  const row = await dbGet<{ key: string; value: string }>(
    'SELECT * FROM app_meta WHERE key = ?',
    [SETTINGS_KEY_PREFIX + key],
  );
  if (!row) {
    return (DEFAULTS as unknown as Record<string, unknown>)[key] ?? null;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const serialised = JSON.stringify(value);
  await dbRun(
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`,
    [SETTINGS_KEY_PREFIX + key, serialised],
  );
}

async function getAllSettings(): Promise<NexusSettings> {
  const rows = await dbAll<{ key: string; value: string }>(
    `SELECT * FROM app_meta WHERE key LIKE ?`,
    [SETTINGS_KEY_PREFIX + '%'],
  );

  const result = { ...DEFAULTS };
  for (const row of rows) {
    const settingKey = row.key.replace(SETTINGS_KEY_PREFIX, '');
    if (settingKey in result) {
      try {
        (result as Record<string, unknown>)[settingKey] = JSON.parse(row.value);
      } catch {
        (result as Record<string, unknown>)[settingKey] = row.value;
      }
    }
  }

  return result;
}

function notifyRenderer(key: string, value: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.SETTINGS_CHANGED, key, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerSettingsHandlers(): void {
  // ── SETTINGS_GET ────────────────────────────────────────────
  ipcMain.handle(IPC.SETTINGS_GET, async (_event, key: string) => {
    try {
      const value = await getSetting(key);
      return ok(value);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SETTINGS_SET ────────────────────────────────────────────
  ipcMain.handle(IPC.SETTINGS_SET, async (_event, key: string, value: unknown) => {
    try {
      await setSetting(key, value);
      notifyRenderer(key, value);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SETTINGS_GET_ALL ────────────────────────────────────────
  ipcMain.handle(IPC.SETTINGS_GET_ALL, async () => {
    try {
      const settings = await getAllSettings();
      return ok(settings);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SETTINGS_RESET ──────────────────────────────────────────
  ipcMain.handle(IPC.SETTINGS_RESET, async (_event, key: string) => {
    try {
      const defaultValue = (DEFAULTS as unknown as Record<string, unknown>)[key];
      if (defaultValue === undefined) {
        throw new Error(`Unknown setting: ${key}`);
      }
      await setSetting(key, defaultValue);
      notifyRenderer(key, defaultValue);
      return ok(defaultValue);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
