// ============================================================
// Nexus SSH Client — SFTP IPC Handlers
// ============================================================

import { ipcMain } from 'electron';
import { IPC } from '../../shared/constants';
import { sftpManager } from '../sftp/index';

/** Wrap a handler result in a standardised envelope. */
function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

export function registerSFTPHandlers(): void {
  // ── SFTP_LIST ───────────────────────────────────────────────
  ipcMain.handle(IPC.SFTP_LIST, async (_event, sessionId: string, remotePath: string) => {
    try {
      const entries = await sftpManager.listDirectory(sessionId, remotePath);
      return ok(entries);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SFTP_UPLOAD ─────────────────────────────────────────────
  ipcMain.handle(
    IPC.SFTP_UPLOAD,
    async (_event, sessionId: string, localPath: string, remotePath: string) => {
      try {
        const transferId = await sftpManager.upload(sessionId, localPath, remotePath);
        return ok(transferId);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── SFTP_DOWNLOAD ───────────────────────────────────────────
  ipcMain.handle(
    IPC.SFTP_DOWNLOAD,
    async (_event, sessionId: string, remotePath: string, localPath: string) => {
      try {
        const transferId = await sftpManager.download(sessionId, remotePath, localPath);
        return ok(transferId);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── SFTP_MKDIR ──────────────────────────────────────────────
  ipcMain.handle(IPC.SFTP_MKDIR, async (_event, sessionId: string, remotePath: string) => {
    try {
      await sftpManager.mkdir(sessionId, remotePath);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SFTP_DELETE ─────────────────────────────────────────────
  ipcMain.handle(
    IPC.SFTP_DELETE,
    async (_event, sessionId: string, remotePath: string, isDirectory?: boolean) => {
      try {
        await sftpManager.deleteItem(sessionId, remotePath, isDirectory ?? false);
        return ok(null);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── SFTP_RENAME ─────────────────────────────────────────────
  ipcMain.handle(
    IPC.SFTP_RENAME,
    async (_event, sessionId: string, oldPath: string, newPath: string) => {
      try {
        await sftpManager.rename(sessionId, oldPath, newPath);
        return ok(null);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── SFTP_STAT ───────────────────────────────────────────────
  ipcMain.handle(IPC.SFTP_STAT, async (_event, sessionId: string, remotePath: string) => {
    try {
      const stat = await sftpManager.stat(sessionId, remotePath);
      return ok(stat);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SFTP_CHMOD ──────────────────────────────────────────────
  ipcMain.handle(
    IPC.SFTP_CHMOD,
    async (_event, sessionId: string, remotePath: string, mode: string) => {
      try {
        // mode comes as a string from the renderer (e.g. "755"), parse to octal number
        const numericMode = parseInt(mode, 8);
        await sftpManager.chmod(sessionId, remotePath, numericMode);
        return ok(null);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── SFTP_TRANSFER_PAUSE ─────────────────────────────────────
  ipcMain.handle(IPC.SFTP_TRANSFER_PAUSE, async (_event, transferId: string) => {
    try {
      sftpManager.pauseTransfer(transferId);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SFTP_TRANSFER_RESUME ────────────────────────────────────
  ipcMain.handle(IPC.SFTP_TRANSFER_RESUME, async (_event, transferId: string) => {
    try {
      sftpManager.resumeTransfer(transferId);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SFTP_TRANSFER_CANCEL ────────────────────────────────────
  ipcMain.handle(IPC.SFTP_TRANSFER_CANCEL, async (_event, transferId: string) => {
    try {
      sftpManager.cancelTransfer(transferId);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
