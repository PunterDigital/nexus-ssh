// ============================================================
// Nexus SSH Client — Vault IPC Handlers
// ============================================================

import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { IPC, VAULT_FILE_EXTENSION } from '../../shared/constants';
import { vaultEngine } from '../vault/index';
import { initSodium, deriveKey, generateSalt, zeroBuffer } from '../kdf';
import { resolveVaultDir } from './fs-handlers';
import * as crud from '../vault/crud';

/** Wrap a handler result in a standardised envelope. */
function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

/** Return the configured vault directory, creating it if necessary. */
async function getDefaultVaultDir(): Promise<string> {
  const dir = await resolveVaultDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Turn a vault name into a safe filename while preserving spaces and
 * capitalization. Only strips characters that are invalid on common
 * filesystems (Windows is the strictest: <>:"/\|?*).
 */
function sanitizeVaultFilename(name: string): string {
  const cleaned = name
    .trim()
    // Remove filesystem-invalid characters
    // eslint-disable-next-line no-control-regex -- control characters are invalid in filenames
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '')
    // Collapse repeated spaces
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return cleaned || 'vault';
}

export function registerVaultHandlers(): void {
  // ── VAULT_CREATE ────────────────────────────────────────────
  ipcMain.handle(IPC.VAULT_CREATE, async (_event, password: string, name?: string) => {
    try {
      const dir = await getDefaultVaultDir();
      const base = sanitizeVaultFilename(name ?? 'vault');

      // Pick a filename that doesn't already exist
      let vaultPath = path.join(dir, `${base}${VAULT_FILE_EXTENSION}`);
      let suffix = 2;
      while (true) {
        try {
          await fs.access(vaultPath);
          vaultPath = path.join(dir, `${base} (${suffix})${VAULT_FILE_EXTENSION}`);
          suffix++;
        } catch {
          break; // not found — use this path
        }
      }

      await vaultEngine.create(vaultPath, password);

      // Create a default vault container so hosts have somewhere to live
      const crud = require('../vault/crud');
      await crud.createVault({ name: name ?? 'Default', description: null });

      return ok(vaultPath);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── VAULT_UNLOCK ────────────────────────────────────────────
  ipcMain.handle(
    IPC.VAULT_UNLOCK,
    async (_event, password: string, vaultPath?: string) => {
      try {
        let target = vaultPath;
        if (!target) {
          // Fall back to the first .db in the default dir
          const dir = await getDefaultVaultDir();
          const entries = await fs.readdir(dir);
          const dbFiles = entries.filter((f) => f.endsWith(VAULT_FILE_EXTENSION));
          if (dbFiles.length === 0) {
            throw new Error('No vault file found');
          }
          target = path.join(dir, dbFiles[0]);
        }
        await vaultEngine.unlock(target, password);
        return ok(target);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── VAULT_LOCK ──────────────────────────────────────────────
  ipcMain.handle(IPC.VAULT_LOCK, async () => {
    try {
      // Before locking, check if sync-on-lock is enabled and push the vault
      try {
        const vaultPath = vaultEngine.getVaultPath();
        if (vaultPath && vaultEngine.isUnlocked()) {
          const state = await crud.getSyncState();
          if (state && state.backend_config) {
            try {
              const parsed = JSON.parse(state.backend_config);
              const syncOnLock = parsed?.syncOnLock !== false;
              const backendConfig = parsed?.backendConfig ?? parsed;
              if (syncOnLock && backendConfig && backendConfig.type) {
                const { syncEngine } = require('../sync/engine');
                await syncEngine.configure(backendConfig);
                await syncEngine.push(vaultPath);
              }
            } catch {
              // Don't block the lock if sync fails
            }
          }
        }
      } catch {
        // Don't block the lock if reading sync state fails
      }

      vaultEngine.lock();
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── VAULT_EXISTS ────────────────────────────────────────────
  ipcMain.handle(IPC.VAULT_EXISTS, async () => {
    try {
      const dir = await getDefaultVaultDir();
      const vaultPath = path.join(dir, `vault${VAULT_FILE_EXTENSION}`);
      try {
        await fs.access(vaultPath);
        return ok(true);
      } catch {
        return ok(false);
      }
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── VAULT_CHANGE_PASSWORD ───────────────────────────────────
  ipcMain.handle(
    IPC.VAULT_CHANGE_PASSWORD,
    async (_event, oldPassword: string, newPassword: string) => {
      try {
        // The vault must be currently unlocked
        const currentPath = vaultEngine.getVaultPath();
        if (!currentPath) {
          throw new Error('Vault is not unlocked');
        }

        // Lock the current vault first
        vaultEngine.lock();

        // Re-open with old password to verify correctness
        await vaultEngine.unlock(currentPath, oldPassword);

        // Read the full database content
        const dbKey = vaultEngine.getDbKey();
        if (!dbKey) throw new Error('Unable to read vault key');

        // Generate a new salt and derive a new key
        await initSodium();
        const newSalt = generateSalt();
        const newKey = deriveKey(newPassword, newSalt);
        const hexNewKey = newKey.toString('hex');

        // Re-key the database using SQLCipher's PRAGMA rekey
        const db = vaultEngine.getDb();
        await new Promise<void>((resolve, reject) => {
          db.run(`PRAGMA rekey = "x'${hexNewKey}'";`, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Update the salt file
        const saltPath = currentPath + '.salt';
        await fs.writeFile(saltPath, newSalt.toString('base64'), 'utf-8');

        // Lock and re-unlock with the new password to verify
        vaultEngine.lock();
        zeroBuffer(newKey);
        await vaultEngine.unlock(currentPath, newPassword);

        return ok(null);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── VAULT_LIST ──────────────────────────────────────────────
  ipcMain.handle(IPC.VAULT_LIST, async () => {
    try {
      const dir = await getDefaultVaultDir();
      const entries = await fs.readdir(dir);
      const dbFiles = entries.filter((f) => f.endsWith(VAULT_FILE_EXTENSION));
      return ok(dbFiles.map((f) => path.join(dir, f)));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
