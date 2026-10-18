// ============================================================
// Nexus SSH Client — PIN Quick-Unlock Manager
// Uses Electron's built-in safeStorage API instead of keytar,
// eliminating the need for native compilation.
// ============================================================

import { safeStorage, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
const sodium = require('libsodium-wrappers-sumo');
import * as kdf from '../kdf';
import { PIN_MAX_ATTEMPTS } from '../../shared/constants';

interface StoredPinData {
  wrappedWrappingKey: { nonce: string; ciphertext: string };
  wrappedDbKey: { nonce: string; ciphertext: string };
  pinSalt: string;
}

export function getPinStorePath(): string {
  return path.join(app.getPath('userData'), 'pin-store');
}

function getPinFilePath(vaultId: string): string {
  return path.join(getPinStorePath(), `${vaultId}.pin`);
}

function ensurePinStoreDir(): void {
  const dir = getPinStorePath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function storeEncrypted(vaultId: string, data: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available. Cannot store PIN data securely.');
  }
  ensurePinStoreDir();
  const encrypted = safeStorage.encryptString(data);
  fs.writeFileSync(getPinFilePath(vaultId), encrypted);
}

function loadEncrypted(vaultId: string): string | null {
  const filePath = getPinFilePath(vaultId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available. Cannot read PIN data.');
  }
  const encrypted = fs.readFileSync(filePath);
  return safeStorage.decryptString(encrypted);
}

function deleteEncrypted(vaultId: string): void {
  const filePath = getPinFilePath(vaultId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

class PinManager {
  private failedAttempts: number = 0;

  async setupPin(pin: string, dbKey: Buffer, vaultId: string): Promise<void> {
    await kdf.initSodium();

    const wrappingKey = Buffer.from(sodium.randombytes_buf(32));

    try {
      const wrappedDbKey = kdf.wrapKey(dbKey, wrappingKey);
      const pinSalt = kdf.generateSalt();
      const pinKey = kdf.derivePinKey(pin, pinSalt);

      try {
        const wrappedWrappingKey = kdf.wrapKey(wrappingKey, pinKey);

        const payload: StoredPinData = {
          wrappedWrappingKey: {
            nonce: wrappedWrappingKey.nonce.toString('base64'),
            ciphertext: wrappedWrappingKey.ciphertext.toString('base64'),
          },
          wrappedDbKey: {
            nonce: wrappedDbKey.nonce.toString('base64'),
            ciphertext: wrappedDbKey.ciphertext.toString('base64'),
          },
          pinSalt: pinSalt.toString('base64'),
        };

        storeEncrypted(vaultId, JSON.stringify(payload));
      } finally {
        kdf.zeroBuffer(pinKey);
      }
    } finally {
      kdf.zeroBuffer(wrappingKey);
    }

    this.failedAttempts = 0;
  }

  async unlockWithPin(pin: string, vaultId: string): Promise<Buffer> {
    if (this.failedAttempts >= PIN_MAX_ATTEMPTS) {
      deleteEncrypted(vaultId);
      throw new Error('PIN locked out. Too many failed attempts. Please unlock with your master password.');
    }

    await kdf.initSodium();

    const raw = loadEncrypted(vaultId);
    if (!raw) {
      throw new Error('PIN is not set up for this vault.');
    }

    let stored: StoredPinData;
    try {
      stored = JSON.parse(raw) as StoredPinData;
    } catch {
      throw new Error('Stored PIN data is corrupted.');
    }

    const pinSalt = Buffer.from(stored.pinSalt, 'base64');
    const pinKey = kdf.derivePinKey(pin, pinSalt);

    let wrappingKey: Buffer;
    try {
      wrappingKey = kdf.unwrapKey(
        Buffer.from(stored.wrappedWrappingKey.ciphertext, 'base64'),
        Buffer.from(stored.wrappedWrappingKey.nonce, 'base64'),
        pinKey,
      );
    } catch {
      this.failedAttempts++;
      if (this.failedAttempts >= PIN_MAX_ATTEMPTS) {
        deleteEncrypted(vaultId);
        throw new Error('PIN locked out. Too many failed attempts. Please unlock with your master password.');
      }
      throw new Error(
        `Incorrect PIN. ${PIN_MAX_ATTEMPTS - this.failedAttempts} attempt(s) remaining.`,
      );
    } finally {
      kdf.zeroBuffer(pinKey);
    }

    let dbKey: Buffer;
    try {
      dbKey = kdf.unwrapKey(
        Buffer.from(stored.wrappedDbKey.ciphertext, 'base64'),
        Buffer.from(stored.wrappedDbKey.nonce, 'base64'),
        wrappingKey,
      );
    } catch {
      this.failedAttempts++;
      if (this.failedAttempts >= PIN_MAX_ATTEMPTS) {
        deleteEncrypted(vaultId);
        throw new Error('PIN locked out. Stored data may be corrupted. Please unlock with your master password.');
      }
      throw new Error('Failed to unwrap database key. Stored PIN data may be corrupted.');
    } finally {
      kdf.zeroBuffer(wrappingKey);
    }

    this.failedAttempts = 0;
    return dbKey;
  }

  isPinSetup(vaultId: string): boolean {
    return fs.existsSync(getPinFilePath(vaultId));
  }

  clearPin(vaultId: string): void {
    deleteEncrypted(vaultId);
    this.failedAttempts = 0;
  }

  resetAttempts(): void {
    this.failedAttempts = 0;
  }

  isLockedOut(): boolean {
    return this.failedAttempts >= PIN_MAX_ATTEMPTS;
  }

  getRemainingAttempts(): number {
    return Math.max(0, PIN_MAX_ATTEMPTS - this.failedAttempts);
  }
}

export const pinManager = new PinManager();
