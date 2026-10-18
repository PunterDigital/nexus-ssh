// ============================================================
// Nexus SSH Client — PIN quick-unlock IPC handlers (#2653)
// ============================================================

import { ipcMain } from 'electron';
import { IPC } from '../../shared/constants';
import { vaultEngine } from '../vault/index';
import { pinStore } from '../vault/pin-unlock';
import { zeroBuffer } from '../kdf';

function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerPinHandlers(): void {
  // ── PIN_STATUS ── whether a vault can be unlocked with a PIN, and the attempts left
  ipcMain.handle(IPC.PIN_STATUS, async (_event, vaultPath: string) => {
    try {
      return ok(pinStore.status(vaultPath));
    } catch (err: unknown) {
      return fail(message(err));
    }
  });

  // ── PIN_SETUP ── turn PIN unlock on (or change the PIN) for the open vault
  ipcMain.handle(IPC.PIN_SETUP, async (_event, pin: string) => {
    try {
      const vaultPath = vaultEngine.getVaultPath();
      const dbKey = vaultEngine.getDbKey();
      if (!vaultEngine.isUnlocked() || !vaultPath || !dbKey) {
        throw new Error('Unlock the vault before setting up a PIN.');
      }
      await pinStore.setup(vaultPath, pin, dbKey, vaultEngine.getCurrentPassword());
      return ok(pinStore.status(vaultPath));
    } catch (err: unknown) {
      return fail(message(err));
    }
  });

  // ── PIN_CLEAR ── turn PIN unlock off for the open vault
  ipcMain.handle(IPC.PIN_CLEAR, async () => {
    try {
      const vaultPath = vaultEngine.getVaultPath();
      if (!vaultEngine.isUnlocked() || !vaultPath) {
        throw new Error('Unlock the vault before turning PIN unlock off.');
      }
      pinStore.clear(vaultPath);
      return ok(null);
    } catch (err: unknown) {
      return fail(message(err));
    }
  });

  // ── PIN_UNLOCK ──────────────────────────────────────────────
  ipcMain.handle(IPC.PIN_UNLOCK, async (_event, vaultPath: string, pin: string) => {
    let dbKey: Buffer | null = null;
    try {
      const secrets = await pinStore.unlock(vaultPath, String(pin ?? ''));
      dbKey = secrets.dbKey;
      try {
        await vaultEngine.unlockWithKey(vaultPath, dbKey, {
          password: secrets.password,
          wrongKeyMessage: 'This vault has changed since the PIN was set (new password or a sync pull).',
        });
      } catch (err: unknown) {
        // The vault file no longer matches the key the PIN unlocks: the PIN is useless now.
        pinStore.clear(vaultPath);
        throw new Error(`${message(err)} PIN unlock is off: unlock another way and set it up again.`);
      }
      return ok(vaultPath);
    } catch (err: unknown) {
      return fail(message(err));
    } finally {
      if (dbKey) zeroBuffer(dbKey);
    }
  });
}
