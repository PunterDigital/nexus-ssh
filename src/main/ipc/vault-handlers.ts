// ============================================================
// Nexus SSH Client — Vault IPC Handlers
// ============================================================

import { ipcMain, shell } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { IPC, VAULT_FILE_EXTENSION } from '../../shared/constants';
import { vaultEngine } from '../vault/index';
import { initSodium, deriveKey, generateSalt, zeroBuffer } from '../kdf';
import { resolveVaultDir } from './fs-handlers';
import * as crud from '../vault/crud';
import { sshManager } from '../ssh';
import { sftpManager } from '../sftp';
import { getStoreDir as hardwareKeyStoreDir } from '../hardware-key/index';
import { pinStore } from '../vault/pin-unlock';
import {
  deleteVault,
  renameVault,
  resolveListedVault,
  sanitizeVaultFilename,
  type VaultFileContext,
} from '../vault/manage';

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
 * Move a file to the OS Recycle Bin / Trash. A test profile can set NEXUS_TRASH_DIR so E2E runs
 * check what was thrown away without filling the real Recycle Bin.
 */
async function trash(file: string): Promise<void> {
  const testTrash = process.env.NEXUS_USER_DATA_DIR ? process.env.NEXUS_TRASH_DIR : undefined;
  if (!testTrash) {
    await shell.trashItem(file);
    return;
  }
  await fs.mkdir(testTrash, { recursive: true });
  await fs.rename(file, path.join(testTrash, `${Date.now()}-${path.basename(file)}`));
}

/** What rename / delete / show-in-folder need to know about the vault picker's folder. */
async function vaultFileContext(): Promise<VaultFileContext> {
  return {
    vaultDir: await getDefaultVaultDir(),
    sideStores: [{ dir: hardwareKeyStoreDir(), ext: '.hwkey' }],
    openVaultPath: vaultEngine.isUnlocked() ? vaultEngine.getVaultPath() : null,
    trash,
  };
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
      await pushBeforeLock();
      vaultEngine.lock();
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── VAULT_SWITCH ────────────────────────────────────────────
  // Same as a lock, but the sessions belong to the vault being left, so they are closed too
  // (a plain lock keeps them; the idle/OS lock in src/main/security closes them).
  ipcMain.handle(IPC.VAULT_SWITCH, async () => {
    try {
      await pushBeforeLock();
      vaultEngine.lock();
      try {
        sshManager.destroyAll();
      } catch {
        // Best-effort cleanup
      }
      try {
        sftpManager.destroyAll();
      } catch {
        // Best-effort cleanup
      }
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── VAULT_CURRENT ───────────────────────────────────────────
  ipcMain.handle(IPC.VAULT_CURRENT, async () => {
    try {
      return ok(vaultEngine.isUnlocked() ? vaultEngine.getVaultPath() : null);
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

        // The PIN unlocks a copy of the old key, which no longer opens the vault (#2653)
        pinStore.clear(currentPath);

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

  // ── VAULT_RENAME / VAULT_DELETE / VAULT_SHOW_IN_FOLDER (#2646) ──
  // Vault picker actions. Only for vaults in the picker's folder, and never the open vault.
  ipcMain.handle(IPC.VAULT_RENAME, async (_event, vaultPath: string, newName: string) => {
    try {
      const renamed = await renameVault(vaultPath, newName, await vaultFileContext());
      pinStore.rename(vaultPath, renamed);
      return ok(renamed);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.VAULT_DELETE, async (_event, vaultPath: string) => {
    try {
      await deleteVault(vaultPath, await vaultFileContext());
      pinStore.clear(vaultPath);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.VAULT_SHOW_IN_FOLDER, async (_event, vaultPath: string) => {
    try {
      shell.showItemInFolder(await resolveListedVault(vaultPath, await vaultFileContext()));
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

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

/** If sync-on-lock is on, push the open vault before it is locked. Never throws. */
async function pushBeforeLock(): Promise<void> {
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
}
