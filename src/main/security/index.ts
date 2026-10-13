// ============================================================
// Nexus SSH Client — Security Manager
// Handles auto-lock on idle/sleep, secure clipboard operations,
// and coordinates vault locking with the renderer.
// ============================================================

import type { BrowserWindow } from 'electron';
import { clipboard, powerMonitor } from 'electron';
import { vaultEngine } from '../vault';
import { sshManager } from '../ssh';
import {
  DEFAULT_AUTO_LOCK_TIMEOUT,
  DEFAULT_CLIPBOARD_CLEAR_TIMEOUT,
} from '../../shared/constants';

class SecurityManager {
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private clipboardTimer: ReturnType<typeof setTimeout> | null = null;
  private autoLockTimeout: number = DEFAULT_AUTO_LOCK_TIMEOUT; // minutes
  private clipboardClearTimeout: number = DEFAULT_CLIPBOARD_CLEAR_TIMEOUT; // seconds
  private mainWindow: BrowserWindow | null = null;
  private lastClipboardText: string | null = null;

  // ---------------------------------------------------------------------------
  // Window reference
  // ---------------------------------------------------------------------------

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  // ---------------------------------------------------------------------------
  // Initialise all security monitoring
  // ---------------------------------------------------------------------------

  init(): void {
    // Power-monitor events: lock vault on system sleep / screen lock
    powerMonitor.on('suspend', () => {
      this.lockVault();
    });

    powerMonitor.on('lock-screen', () => {
      this.lockVault();
    });

    powerMonitor.on('resume', () => {
      this.resetIdleTimer();
    });

    powerMonitor.on('unlock-screen', () => {
      this.resetIdleTimer();
    });

    // Start periodic idle-time checking
    this.startIdleMonitoring();
  }

  // ---------------------------------------------------------------------------
  // Idle monitoring — poll system idle time every 30 seconds
  // ---------------------------------------------------------------------------

  startIdleMonitoring(): void {
    this.stopIdleMonitoring();

    this.idleTimer = setInterval(() => {
      // powerMonitor.getSystemIdleTime() returns seconds of idle time
      const idleSeconds = powerMonitor.getSystemIdleTime();
      const thresholdSeconds = this.autoLockTimeout * 60;

      if (thresholdSeconds > 0 && idleSeconds >= thresholdSeconds) {
        this.lockVault();
      }
    }, 30_000); // check every 30 seconds
  }

  resetIdleTimer(): void {
    // Restarting the monitoring resets the check cycle.
    // The actual idle time comes from the OS so we don't need to
    // track it ourselves — we just ensure the interval is running.
    this.startIdleMonitoring();
  }

  stopIdleMonitoring(): void {
    if (this.idleTimer !== null) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Lock vault — close DB, zero key, notify renderer
  // ---------------------------------------------------------------------------

  lockVault(): void {
    if (!vaultEngine.isUnlocked()) {
      return; // already locked, nothing to do
    }

    // 1. Lock the vault engine (closes DB, zeros key buffer)
    vaultEngine.lock();

    // 2. Disconnect all SSH sessions (best-effort; prevents orphaned connections)
    try {
      sshManager.destroyAll();
    } catch {
      // Best-effort cleanup
    }

    // 3. Notify the renderer to show the lock screen
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('security:vault-locked');
    }
  }

  // ---------------------------------------------------------------------------
  // Secure clipboard — copy with auto-clear
  // ---------------------------------------------------------------------------

  // Electron 44's main-process clipboard is async (readText/writeText return Promises).
  async copyToClipboardSecure(text: string): Promise<void> {
    // 1. Write the text to the system clipboard
    await clipboard.writeText(text);

    // 2. Remember what we wrote so we can verify before clearing
    this.lastClipboardText = text;

    // 3. Clear any existing clipboard timer
    this.clearClipboardTimer();

    // 4. Set a new timer to clear the clipboard after the configured timeout
    this.clipboardTimer = setTimeout(() => {
      this.clipboardTimer = null;
      const expected = this.lastClipboardText;
      this.lastClipboardText = null;

      // Only clear if the clipboard still contains our text
      // (user may have copied something else in the meantime)
      void (async () => {
        try {
          if ((await clipboard.readText()) === expected) {
            await clipboard.writeText('');
          }
        } catch {
          // Best-effort; clipboard access can occasionally throw on some platforms
        }
      })();
    }, this.clipboardClearTimeout * 1000);
  }

  clearClipboardTimer(): void {
    if (this.clipboardTimer !== null) {
      clearTimeout(this.clipboardTimer);
      this.clipboardTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Settings updates
  // ---------------------------------------------------------------------------

  setAutoLockTimeout(minutes: number): void {
    this.autoLockTimeout = minutes;
    // Restart monitoring with the new threshold
    if (this.idleTimer !== null) {
      this.startIdleMonitoring();
    }
  }

  setClipboardClearTimeout(seconds: number): void {
    this.clipboardClearTimeout = seconds;
  }

  // ---------------------------------------------------------------------------
  // Cleanup — call on app quit
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.stopIdleMonitoring();
    this.clearClipboardTimer();
    this.lastClipboardText = null;
    this.mainWindow = null;
  }
}

export const securityManager = new SecurityManager();
