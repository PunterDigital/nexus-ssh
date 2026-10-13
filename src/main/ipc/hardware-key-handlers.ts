// ============================================================
// Nexus SSH Client — Hardware Key (WebAuthn PRF) IPC Handlers
//
// The renderer drives the WebAuthn ceremony and hands us the resulting
// PRF output (and credential metadata for setup). All cryptographic
// wrapping/unwrapping of the vault DEK happens here in the main process.
// ============================================================

import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sodium = require('libsodium-wrappers-sumo');
import { IPC, VAULT_FILE_EXTENSION } from '../../shared/constants';
import { vaultEngine } from '../vault/index';
import { hardwareKeyManager } from '../hardware-key/index';
import { initSodium, zeroBuffer } from '../kdf';
import { resolveVaultDir } from './fs-handlers';
import * as crud from '../vault/crud';

function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

/**
 * Stable per-vault identifier used to scope the .hwkey file. We use the
 * vault filename (without .db) — it's already filesystem-safe because it
 * came from sanitizeVaultFilename at create time.
 */
function vaultIdFromPath(vaultPath: string): string {
  return path.basename(vaultPath, VAULT_FILE_EXTENSION);
}

function sanitizeVaultFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return cleaned || 'vault';
}

async function getDefaultVaultDir(): Promise<string> {
  const dir = await resolveVaultDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

interface SetupPayload {
  credentialId: string;
  prfSalt: string;
  prfOutput: string; // base64
  rpId: string;
  userHandle: string;
}

interface CreatePasswordlessPayload extends SetupPayload {
  name?: string;
}

interface UnlockPayload {
  vaultPath: string;
  prfOutput: string; // base64
}

export function registerHardwareKeyHandlers(): void {
  // ── HWKEY_HAS ───────────────────────────────────────────────
  ipcMain.handle(IPC.HWKEY_HAS, async (_event, vaultPath: string) => {
    try {
      if (!vaultPath) return ok(false);
      const vaultId = vaultIdFromPath(vaultPath);
      return ok(hardwareKeyManager.isSetup(vaultId));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── HWKEY_GET_INFO ──────────────────────────────────────────
  // Returns credentialId/prfSalt/rpId so the renderer can perform the
  // WebAuthn assertion (credentialId in allowCredentials, salt as PRF input).
  ipcMain.handle(IPC.HWKEY_GET_INFO, async (_event, vaultPath: string) => {
    try {
      const vaultId = vaultIdFromPath(vaultPath);
      const info = hardwareKeyManager.getCredentialInfo(vaultId);
      if (!info) throw new Error('Hardware key is not set up for this vault.');
      return ok(info);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── HWKEY_SETUP ─────────────────────────────────────────────
  // Add a hardware key to an already-unlocked, password-protected vault.
  // Wraps the live DEK from the vault engine.
  ipcMain.handle(IPC.HWKEY_SETUP, async (_event, payload: SetupPayload) => {
    try {
      if (!vaultEngine.isUnlocked()) {
        throw new Error('Vault must be unlocked before adding a hardware key.');
      }
      const vaultPath = vaultEngine.getVaultPath();
      const dbKey = vaultEngine.getDbKey();
      if (!vaultPath || !dbKey) {
        throw new Error('Vault is not in a state that can register a hardware key.');
      }

      const prfOutput = Buffer.from(payload.prfOutput, 'base64');
      try {
        await hardwareKeyManager.setup({
          vaultId: vaultIdFromPath(vaultPath),
          dbKey,
          prfOutput,
          credentialId: payload.credentialId,
          prfSalt: payload.prfSalt,
          rpId: payload.rpId,
          userHandle: payload.userHandle,
          passwordless: false,
        });
      } finally {
        zeroBuffer(prfOutput);
      }
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── HWKEY_CREATE_PASSWORDLESS ───────────────────────────────
  // Create a brand-new vault that has NO master password — the only way
  // in is via the supplied hardware-key credential.
  ipcMain.handle(
    IPC.HWKEY_CREATE_PASSWORDLESS,
    async (_event, payload: CreatePasswordlessPayload) => {
      let dbKey: Buffer | null = null;
      const prfOutput = Buffer.from(payload.prfOutput, 'base64');

      try {
        await initSodium();

        const dir = await getDefaultVaultDir();
        const base = sanitizeVaultFilename(payload.name ?? 'vault');

        let vaultPath = path.join(dir, `${base}${VAULT_FILE_EXTENSION}`);
        let suffix = 2;
        while (true) {
          try {
            await fs.access(vaultPath);
            vaultPath = path.join(dir, `${base} (${suffix})${VAULT_FILE_EXTENSION}`);
            suffix++;
          } catch {
            break;
          }
        }

        dbKey = Buffer.from(sodium.randombytes_buf(32));

        await vaultEngine.createWithKey(vaultPath, dbKey);
        await crud.createVault({ name: payload.name ?? 'Default', description: null });

        await hardwareKeyManager.setup({
          vaultId: vaultIdFromPath(vaultPath),
          dbKey,
          prfOutput,
          credentialId: payload.credentialId,
          prfSalt: payload.prfSalt,
          rpId: payload.rpId,
          userHandle: payload.userHandle,
          passwordless: true,
        });

        return ok(vaultPath);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      } finally {
        if (dbKey) zeroBuffer(dbKey);
        zeroBuffer(prfOutput);
      }
    },
  );

  // ── HWKEY_UNLOCK ────────────────────────────────────────────
  ipcMain.handle(IPC.HWKEY_UNLOCK, async (_event, payload: UnlockPayload) => {
    let dbKey: Buffer | null = null;
    const prfOutput = Buffer.from(payload.prfOutput, 'base64');

    try {
      const vaultId = vaultIdFromPath(payload.vaultPath);
      dbKey = await hardwareKeyManager.unwrapDbKey(vaultId, prfOutput);
      await vaultEngine.unlockWithKey(payload.vaultPath, dbKey);
      return ok(payload.vaultPath);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    } finally {
      if (dbKey) zeroBuffer(dbKey);
      zeroBuffer(prfOutput);
    }
  });

  // ── HWKEY_REMOVE ────────────────────────────────────────────
  ipcMain.handle(IPC.HWKEY_REMOVE, async (_event, vaultPath: string) => {
    try {
      const vaultId = vaultIdFromPath(vaultPath);
      const info = hardwareKeyManager.getCredentialInfo(vaultId);
      if (info?.passwordless) {
        throw new Error(
          'Cannot remove the hardware key from a passwordless vault — there would be no way left to unlock it. Set a master password first.',
        );
      }
      hardwareKeyManager.clear(vaultId);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
