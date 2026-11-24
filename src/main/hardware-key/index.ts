// ============================================================
// Nexus SSH Client — Hardware Key (FIDO2/WebAuthn PRF) Manager
//
// The renderer drives the WebAuthn ceremony (since navigator.credentials
// only exists there) and hands us a 32-byte PRF output. We use that
// output as a key-wrapping key (KEK) following the same pattern as
// pin-manager.ts:
//
//   wrappingKey      = random 32 bytes
//   wrappedDbKey     = secretbox(dbKey,        wrappingKey)
//   wrappedWrapKey   = secretbox(wrappingKey,  prfOutput)
//
// Storage layout per vault, encrypted with safeStorage's async API
// (#4377: the sync calls are deprecated in Electron 45 and removed in 46;
// decryptStringAsync also reads files written by the old encryptString):
//   ${userData}/hwkey-store/${recordId}.hwkey
// where recordId is `<vault file name>.<hash of its folder>` since #5902
// (v0.6.0 and earlier: the file name only; see record-names.ts for the
// lookup order and the migrate-on-unlock).
// ============================================================

import { safeStorage, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
const sodium = require('libsodium-wrappers-sumo');
import * as kdf from '../kdf';
import { HWKEY_EXTENSION, legacyRecordId, recordCandidates, recordId } from './record-names';

export interface HardwareKeyCredentialInfo {
  /** Base64url-encoded WebAuthn credential ID. */
  credentialId: string;
  /** Base64-encoded 32-byte PRF input salt. */
  prfSalt: string;
  /** WebAuthn relying party ID used at registration. */
  rpId: string;
  /** Base64url-encoded WebAuthn user handle. */
  userHandle: string;
  /** Marks vaults that were created without a master password. */
  passwordless: boolean;
}

interface StoredHardwareKeyData extends HardwareKeyCredentialInfo {
  wrappedWrappingKey: { nonce: string; ciphertext: string };
  wrappedDbKey: { nonce: string; ciphertext: string };
  createdAt: string;
}

export function getStoreDir(): string {
  return path.join(app.getPath('userData'), 'hwkey-store');
}

function getFilePath(vaultId: string): string {
  return path.join(getStoreDir(), `${vaultId}${HWKEY_EXTENSION}`);
}

function ensureDir(): void {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write through a temp file and rename, so a crash mid-write can't leave a
 * truncated .hwkey (for a passwordless vault that file is the only way in).
 */
async function writeAtomic(filePath: string, data: Buffer): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, filePath);
}

async function storeEncrypted(vaultId: string, data: string): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('OS encryption is not available. Cannot store hardware-key data securely.');
  }
  ensureDir();
  const encrypted = await safeStorage.encryptStringAsync(data);
  await writeAtomic(getFilePath(vaultId), encrypted);
}

async function loadEncrypted(vaultId: string): Promise<string | null> {
  const filePath = getFilePath(vaultId);
  if (!fs.existsSync(filePath)) return null;
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('OS encryption is not available. Cannot read hardware-key data.');
  }
  const encrypted = await fs.promises.readFile(filePath);
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted);
  if (shouldReEncrypt) {
    // The OS key was rotated (or a stronger one is available): store the data
    // under the new key. If that fails, the old file still decrypts.
    try {
      await writeAtomic(filePath, await safeStorage.encryptStringAsync(result));
    } catch {
      /* keep the existing file */
    }
  }
  return result;
}

function deleteEncrypted(vaultId: string): void {
  const filePath = getFilePath(vaultId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export interface SetupHardwareKeyOptions {
  vaultId: string;
  dbKey: Buffer;
  prfOutput: Buffer;
  credentialId: string;
  prfSalt: string;
  rpId: string;
  userHandle: string;
  passwordless: boolean;
}

class HardwareKeyManager {
  /**
   * Wrap the supplied DEK with a hardware-key-derived KEK and persist it.
   * Used both when adding a hardware key to an existing password-protected
   * vault and when bootstrapping a passwordless vault (in which case
   * `passwordless` is true and there is no .salt file on disk).
   */
  async setup(options: SetupHardwareKeyOptions): Promise<void> {
    await kdf.initSodium();

    if (options.prfOutput.length !== 32) {
      throw new Error('PRF output must be 32 bytes');
    }
    if (options.dbKey.length !== 32) {
      throw new Error('DB key must be 32 bytes');
    }

    const wrappingKey = Buffer.from(sodium.randombytes_buf(32));
    try {
      const wrappedDbKey = kdf.wrapKey(options.dbKey, wrappingKey);
      const wrappedWrappingKey = kdf.wrapKey(wrappingKey, options.prfOutput);

      const payload: StoredHardwareKeyData = {
        credentialId: options.credentialId,
        prfSalt: options.prfSalt,
        rpId: options.rpId,
        userHandle: options.userHandle,
        passwordless: options.passwordless,
        wrappedWrappingKey: {
          nonce: wrappedWrappingKey.nonce.toString('base64'),
          ciphertext: wrappedWrappingKey.ciphertext.toString('base64'),
        },
        wrappedDbKey: {
          nonce: wrappedDbKey.nonce.toString('base64'),
          ciphertext: wrappedDbKey.ciphertext.toString('base64'),
        },
        createdAt: new Date().toISOString(),
      };

      await storeEncrypted(options.vaultId, JSON.stringify(payload));
    } finally {
      kdf.zeroBuffer(wrappingKey);
    }
  }

  /**
   * Unwrap and return the vault DEK using a PRF output produced by the
   * hardware key. Caller is responsible for zeroing the returned buffer
   * once the vault has been opened.
   */
  async unwrapDbKey(vaultId: string, prfOutput: Buffer): Promise<Buffer> {
    await kdf.initSodium();

    const raw = await loadEncrypted(vaultId);
    if (!raw) {
      throw new Error('Hardware key is not set up for this vault.');
    }

    let stored: StoredHardwareKeyData;
    try {
      stored = JSON.parse(raw) as StoredHardwareKeyData;
    } catch {
      throw new Error('Stored hardware-key data is corrupted.');
    }

    let wrappingKey: Buffer;
    try {
      wrappingKey = kdf.unwrapKey(
        Buffer.from(stored.wrappedWrappingKey.ciphertext, 'base64'),
        Buffer.from(stored.wrappedWrappingKey.nonce, 'base64'),
        prfOutput,
      );
    } catch {
      throw new Error('Hardware key did not produce the expected secret. Wrong key, or the credential has been reset.');
    }

    try {
      const dbKey = kdf.unwrapKey(
        Buffer.from(stored.wrappedDbKey.ciphertext, 'base64'),
        Buffer.from(stored.wrappedDbKey.nonce, 'base64'),
        wrappingKey,
      );
      return dbKey;
    } finally {
      kdf.zeroBuffer(wrappingKey);
    }
  }

  isSetup(vaultId: string): boolean {
    return fs.existsSync(getFilePath(vaultId));
  }

  /**
   * Public credential metadata required by the renderer to perform the
   * WebAuthn assertion (allowCredentials, PRF salt, RP id).
   */
  async getCredentialInfo(vaultId: string): Promise<HardwareKeyCredentialInfo | null> {
    const raw = await loadEncrypted(vaultId);
    if (!raw) return null;
    let stored: StoredHardwareKeyData;
    try {
      stored = JSON.parse(raw) as StoredHardwareKeyData;
    } catch {
      return null;
    }
    return {
      credentialId: stored.credentialId,
      prfSalt: stored.prfSalt,
      rpId: stored.rpId,
      userHandle: stored.userHandle,
      passwordless: stored.passwordless,
    };
  }

  clear(vaultId: string): void {
    deleteEncrypted(vaultId);
  }

  // ── Records by vault path (#5902) ─────────────────────────────
  // The IPC handlers work with vault paths; record-names.ts decides which file belongs to one.

  /** The record id new hardware-key data for this vault is written under. */
  ownRecordId(vaultPath: string): string {
    return recordId(vaultPath);
  }

  /**
   * The record that unlocks this vault: its own path-named one, else the v0.6.0 file-name one,
   * else the only path-named one for this file name in another folder. Null when there is none.
   */
  async findRecord(vaultPath: string): Promise<string | null> {
    let files: string[];
    try {
      files = await fs.promises.readdir(getStoreDir());
    } catch {
      return null;
    }
    return recordCandidates(vaultPath, files)[0] ?? null;
  }

  /**
   * Called after record `usedId` has unlocked the vault at `vaultPath`.
   * - A record found under another name is copied to the vault's own name. The original stays,
   *   so a failed or interrupted copy loses nothing.
   * - Once the vault's own record has unlocked it, the old file-name record is deleted if it
   *   holds the same data (it was the source of that copy). One with different data may belong
   *   to another vault of the same name, so it stays. Records from other folders always stay:
   *   they may belong to a copy of this vault there.
   * Never throws: the vault is already open, and the old record still works next time.
   */
  async settleAfterUnlock(vaultPath: string, usedId: string): Promise<void> {
    const own = recordId(vaultPath);
    try {
      if (usedId !== own) {
        ensureDir();
        await writeAtomic(getFilePath(own), await fs.promises.readFile(getFilePath(usedId)));
        return;
      }
      const legacy = legacyRecordId(vaultPath);
      if (legacy === own || !fs.existsSync(getFilePath(legacy))) return;
      const [ownData, legacyData] = await Promise.all([loadEncrypted(own), loadEncrypted(legacy)]);
      if (ownData !== null && ownData === legacyData) deleteEncrypted(legacy);
    } catch {
      /* best effort: try again on the next unlock */
    }
  }

  /**
   * Remove the hardware key from a vault: the record `findRecord` returns, plus the old
   * file-name record when it holds the same data.
   */
  async removeForVault(vaultPath: string, foundId: string): Promise<void> {
    const legacy = legacyRecordId(vaultPath);
    if (foundId !== legacy && fs.existsSync(getFilePath(legacy))) {
      const [found, old] = await Promise.all([loadEncrypted(foundId), loadEncrypted(legacy)]);
      if (found !== null && found === old) deleteEncrypted(legacy);
    }
    deleteEncrypted(foundId);
  }
}

export const hardwareKeyManager = new HardwareKeyManager();
