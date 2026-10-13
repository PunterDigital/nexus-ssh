import { useEffect } from 'react';

// ============================================================
// IPC Hooks — event listener hooks for main → renderer events
// ============================================================

/**
 * Listen for SSH data events for a specific session.
 * Sets up the listener on mount and cleans up on unmount.
 */
export function useSSHData(
  sessionId: string | null,
  callback: (data: string) => void
): void {
  useEffect(() => {
    if (!sessionId) return;

    const cleanup = window.nexus.ssh.onData((sid, data) => {
      if (sid === sessionId) {
        callback(data);
      }
    });

    return cleanup;
  }, [sessionId, callback]);
}

/**
 * Listen for SSH close events for a specific session.
 * Sets up the listener on mount and cleans up on unmount.
 */
export function useSSHClose(
  sessionId: string | null,
  callback: (code: number) => void
): void {
  useEffect(() => {
    if (!sessionId) return;

    const cleanup = window.nexus.ssh.onClose((sid, code) => {
      if (sid === sessionId) {
        callback(code);
      }
    });

    return cleanup;
  }, [sessionId, callback]);
}

/**
 * Listen for sync status updates from the main process.
 */
export function useSyncStatus(
  callback: (status: unknown) => void
): void {
  useEffect(() => {
    const cleanup = window.nexus.sync.onSyncStatus(callback);
    return cleanup;
  }, [callback]);
}

/**
 * Listen for SFTP transfer progress events.
 */
export function useSFTPTransferProgress(
  callback: (progress: unknown) => void
): void {
  useEffect(() => {
    const cleanup = window.nexus.sftp.onTransferProgress(callback);
    return cleanup;
  }, [callback]);
}

/**
 * Listen for settings changes from the main process.
 */
export function useSettingsChanged(
  callback: (key: string, value: unknown) => void
): void {
  useEffect(() => {
    const cleanup = window.nexus.settings.onChanged(callback);
    return cleanup;
  }, [callback]);
}

/**
 * Listen for system lock events (e.g., OS screen lock).
 * Useful for auto-locking the vault.
 */
export function useSystemLock(callback: () => void): void {
  useEffect(() => {
    const cleanup = window.nexus.system.onLock(callback);
    return cleanup;
  }, [callback]);
}

/**
 * Listen for system suspend events.
 */
export function useSystemSuspend(callback: () => void): void {
  useEffect(() => {
    const cleanup = window.nexus.system.onSuspend(callback);
    return cleanup;
  }, [callback]);
}
