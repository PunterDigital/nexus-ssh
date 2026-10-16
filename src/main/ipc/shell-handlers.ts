// ============================================================
// Nexus SSH Client — External link IPC Handlers
// ============================================================

import { ipcMain, shell } from 'electron';
import { IPC } from '../../shared/constants';
import { isAllowedExternalUrl } from '../shell/external-links';

export function registerShellHandlers(): void {
  // Only allow-listed https links: a compromised renderer must not open arbitrary URLs or files.
  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, url: unknown) => {
    if (!isAllowedExternalUrl(url)) {
      return { success: false as const, error: 'This link is not allowed' };
    }
    try {
      await shell.openExternal(url as string);
      return { success: true as const, data: null };
    } catch (err: unknown) {
      return { success: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
