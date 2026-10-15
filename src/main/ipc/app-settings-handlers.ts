// ============================================================
// Nexus SSH Client — App-level Settings IPC Handlers
// Stores UI-only preferences (theme, font size, etc.) in a
// plain JSON file in userData, outside the encrypted vault.
// These persist across vaults and are available before unlock.
// ============================================================

import { ipcMain, app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { IPC } from '../../shared/constants';

function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

function getAppSettingsPath(): string {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

/** Read app-settings.json (empty object if missing or malformed). */
export async function readAppSettings(): Promise<Record<string, unknown>> {
  try {
    const file = getAppSettingsPath();
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // File doesn't exist or is malformed — return empty
  }
  return {};
}

async function writeAll(data: Record<string, unknown>): Promise<void> {
  const file = getAppSettingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
}

export function registerAppSettingsHandlers(): void {
  ipcMain.handle(IPC.APP_SETTINGS_GET, async (_event, key: string) => {
    try {
      const all = await readAppSettings();
      return ok(all[key] ?? null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(
    IPC.APP_SETTINGS_SET,
    async (_event, key: string, value: unknown) => {
      try {
        const all = await readAppSettings();
        all[key] = value;
        await writeAll(all);
        return ok(null);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  ipcMain.handle(IPC.APP_SETTINGS_GET_ALL, async () => {
    try {
      return ok(await readAppSettings());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
