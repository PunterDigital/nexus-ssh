// ============================================================
// Nexus SSH Client — PIN quick-unlock (#2653)
//
// Turning PIN unlock on wraps a copy of the open vault's key (and its master password, so a
// sync pull can still reopen the vault) with a key derived from the PIN. The wrapped copy lives
// only in this process's memory: a cold start always needs the master password or hardware key,
// and the PIN works again for later locks in that session.
//
// Wrong PINs are counted here, in the main process. After PIN_MAX_ATTEMPTS wrong tries the
// wrapped copy is thrown away, so PIN unlock is off for that vault until it is set up again.
// No Electron imports: unit-tested in tests/unit/pin-unlock.test.ts.
// ============================================================

import path from 'path';
import { PIN_MAX_ATTEMPTS } from '../../shared/constants';
import { derivePinKey, generateSalt, initSodium, unwrapKey, wrapKey, zeroBuffer } from '../kdf';

/** 4–8 digits. */
export const PIN_PATTERN = /^\d{4,8}$/;

export interface PinStatus {
  enabled: boolean;
  attemptsLeft: number;
}

export interface PinSecrets {
  dbKey: Buffer;
  /** The master password, when the vault was opened with one (null for a hardware-key unlock). */
  password: string | null;
}

/** A wrong PIN. `attemptsLeft` is 0 once PIN unlock has been turned off for the vault. */
export class PinUnlockError extends Error {
  constructor(
    message: string,
    readonly attemptsLeft: number,
  ) {
    super(message);
    this.name = 'PinUnlockError';
  }
}

interface Wrapped {
  nonce: Buffer;
  ciphertext: Buffer;
}

interface Entry {
  salt: Buffer;
  key: Wrapped;
  password: Wrapped | null;
  failed: number;
}

function vaultKey(vaultPath: string): string {
  const resolved = path.resolve(vaultPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export class PinStore {
  private entries = new Map<string, Entry>();

  constructor(private readonly maxAttempts: number = PIN_MAX_ATTEMPTS) {}

  /** Turn PIN unlock on (or change the PIN) for a vault. Replaces any earlier PIN. */
  async setup(vaultPath: string, pin: string, dbKey: Buffer, password: string | null): Promise<void> {
    if (!PIN_PATTERN.test(pin)) {
      throw new Error('PIN must be 4 to 8 digits.');
    }
    await initSodium();
    const salt = generateSalt();
    const pinKey = derivePinKey(pin, salt);
    try {
      const passwordBuf = password === null ? null : Buffer.from(password, 'utf-8');
      try {
        this.entries.set(vaultKey(vaultPath), {
          salt,
          key: wrapKey(dbKey, pinKey),
          password: passwordBuf ? wrapKey(passwordBuf, pinKey) : null,
          failed: 0,
        });
      } finally {
        if (passwordBuf) zeroBuffer(passwordBuf);
      }
    } finally {
      zeroBuffer(pinKey);
    }
  }

  status(vaultPath: string): PinStatus {
    const entry = this.entries.get(vaultKey(vaultPath));
    return {
      enabled: Boolean(entry),
      attemptsLeft: entry ? this.maxAttempts - entry.failed : 0,
    };
  }

  /**
   * Check a PIN and return the vault key (and password). A wrong PIN throws a PinUnlockError
   * with the attempts left; the last one turns PIN unlock off for the vault.
   */
  async unlock(vaultPath: string, pin: string): Promise<PinSecrets> {
    const id = vaultKey(vaultPath);
    const entry = this.entries.get(id);
    if (!entry) {
      throw new PinUnlockError('PIN unlock is not set up for this vault.', 0);
    }
    await initSodium();

    const pinKey = derivePinKey(pin, entry.salt);
    try {
      let dbKey: Buffer;
      try {
        dbKey = unwrapKey(entry.key.ciphertext, entry.key.nonce, pinKey);
      } catch {
        entry.failed++;
        const left = this.maxAttempts - entry.failed;
        if (left <= 0) {
          this.entries.delete(id);
          throw new PinUnlockError(
            'Too many wrong PINs. PIN unlock is off for this vault: choose another way to unlock.',
            0,
          );
        }
        throw new PinUnlockError(`Wrong PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`, left);
      }

      let password: string | null = null;
      if (entry.password) {
        const raw = unwrapKey(entry.password.ciphertext, entry.password.nonce, pinKey);
        password = raw.toString('utf-8');
        zeroBuffer(raw);
      }
      entry.failed = 0;
      return { dbKey, password };
    } finally {
      zeroBuffer(pinKey);
    }
  }

  /** Turn PIN unlock off for a vault. */
  clear(vaultPath: string): void {
    this.forget(this.entries.get(vaultKey(vaultPath)));
    this.entries.delete(vaultKey(vaultPath));
  }

  /** Keep a vault's PIN when its files are renamed. */
  rename(from: string, to: string): void {
    const entry = this.entries.get(vaultKey(from));
    if (!entry) return;
    this.entries.delete(vaultKey(from));
    this.entries.set(vaultKey(to), entry);
  }

  private forget(entry: Entry | undefined): void {
    if (!entry) return;
    zeroBuffer(entry.key.ciphertext);
    if (entry.password) zeroBuffer(entry.password.ciphertext);
  }
}

export const pinStore = new PinStore();
