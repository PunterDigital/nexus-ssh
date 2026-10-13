// ============================================================
// Nexus SSH Client — Clipboard IPC Handlers
// ============================================================

import { ipcMain } from 'electron';
import { securityManager } from '../security';

/**
 * Register clipboard-related IPC handlers.
 */
export function registerClipboardHandlers(): void {
  // Copy sensitive text (e.g. passwords) to clipboard with auto-clear
  ipcMain.handle('clipboard:copy-secure', async (_event, text: string) => {
    if (typeof text !== 'string') {
      throw new Error('clipboard:copy-secure expects a string argument');
    }
    await securityManager.copyToClipboardSecure(text);
  });
}
