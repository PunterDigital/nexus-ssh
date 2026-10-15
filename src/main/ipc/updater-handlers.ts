// ============================================================
// Nexus SSH Client — App update IPC Handlers
// ============================================================

import { ipcMain, shell } from 'electron';
import { DOWNLOADS_PAGE_URL, IPC } from '../../shared/constants';
import { updater } from '../updater/index';

function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC.UPDATER_GET_STATUS, () => ok(updater.getStatus()));

  ipcMain.handle(IPC.UPDATER_CHECK, async () => ok(await updater.check()));

  ipcMain.handle(IPC.UPDATER_INSTALL, () => {
    try {
      updater.install();
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // Fixed URL: the renderer can't ask the main process to open arbitrary links.
  ipcMain.handle(IPC.UPDATER_OPEN_DOWNLOADS, async () => {
    try {
      await shell.openExternal(DOWNLOADS_PAGE_URL);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
