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
// Storage layout per vault, encrypted with safeStorage:
//   ${userData}/hwkey-store/${vaultId}.hwkey
// ============================================================

import { safeStorage, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
const sodium = require('libsodium-wrappers-sumo');
import * as kdf from '../kdf';

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
  return path.join(getStoreDir(), `${vaultId}.hwkey`);
}

function ensureDir(): void {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function storeEncrypted(vaultId: string, data: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available. Cannot store hardware-key data securely.');
  }
  ensureDir();
  const encrypted = safeStorage.encryptString(data);
  fs.writeFileSync(getFilePath(vaultId), encrypted);
}

function loadEncrypted(vaultId: string): string | null {
  const filePath = getFilePath(vaultId);
  if (!fs.existsSync(filePath)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available. Cannot read hardware-key data.');
  }
  const encrypted = fs.readFileSync(filePath);
  return safeStorage.decryptString(encrypted);
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

      storeEncrypted(options.vaultId, JSON.stringify(payload));
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

    const raw = loadEncrypted(vaultId);
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
  getCredentialInfo(vaultId: string): HardwareKeyCredentialInfo | null {
    const raw = loadEncrypted(vaultId);
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
}

export const hardwareKeyManager = new HardwareKeyManager();
