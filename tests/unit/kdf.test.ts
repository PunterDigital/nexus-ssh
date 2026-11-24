import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  initSodium,
  generateSalt,
  deriveKey,
  derivePinKey,
  wrapKey,
  unwrapKey,
  zeroBuffer,
  kdfStats,
  stopKdfWorker,
} from '../../src/main/kdf';
import {
  ARGON2_KEY_BYTES,
  ARGON2_MEM_LIMIT,
  ARGON2_OPS_LIMIT,
  ARGON2_SALT_BYTES,
  PIN_ARGON2_MEM_LIMIT,
  PIN_ARGON2_OPS_LIMIT,
} from '../../src/shared/constants';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sodium = require('libsodium-wrappers-sumo');

beforeAll(async () => {
  await initSodium();
});

afterAll(async () => {
  await stopKdfWorker();
});

/** What the vault used before #5661: libsodium's crypto_pwhash on the calling thread. */
function referenceKey(secret: string, salt: Buffer, ops: number, mem: number): Buffer {
  return Buffer.from(
    sodium.crypto_pwhash(
      ARGON2_KEY_BYTES,
      secret,
      new Uint8Array(salt),
      ops,
      mem,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    ),
  );
}

describe('kdf', () => {
  it('generates random salts of the configured length', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).toHaveLength(ARGON2_SALT_BYTES);
    expect(a.equals(b)).toBe(false);
  });

  it('gives byte-identical keys to sodium.crypto_pwhash, so existing vaults still open (#5661)', async () => {
    const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const before = kdfStats.inWorker;
    const key = await deriveKey('correct horse battery staple', salt);
    expect(kdfStats.inWorker).toBe(before + 1); // ran in the worker, not here
    expect(key.equals(referenceKey('correct horse battery staple', salt, ARGON2_OPS_LIMIT, ARGON2_MEM_LIMIT))).toBe(true);
    // A fixed vector, so a parameter change can't slip through by changing both sides.
    expect(key.toString('hex')).toBe(
      'aad608b5866cef907f47d5cae529ed01a91301c92c5d5fef46e1a65e394e5742',
    );

    const pin = await derivePinKey('2468', salt);
    expect(pin.equals(referenceKey('2468', salt, PIN_ARGON2_OPS_LIMIT, PIN_ARGON2_MEM_LIMIT))).toBe(true);
  });

  it('keeps this thread free while Argon2id runs (#5661)', async () => {
    let maxGap = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 5);
    const started = performance.now();
    await deriveKey('a password', generateSalt());
    const took = performance.now() - started;
    clearInterval(timer);
    expect(took).toBeGreaterThan(100); // the derivation really ran (256 MiB, 3 passes)
    expect(maxGap).toBeLessThan(60);
  });

  it('runs derivations one after another without mixing up results', async () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    const [a, b, a2] = await Promise.all([
      derivePinKey('1111', s1),
      derivePinKey('2222', s2),
      derivePinKey('1111', s1),
    ]);
    expect(a.equals(a2)).toBe(true);
    expect(a.equals(b)).toBe(false);
  });

  it('derives the same key for the same password and salt', async () => {
    const salt = generateSalt();
    const k1 = await deriveKey('correct horse battery staple', salt);
    const k2 = await deriveKey('correct horse battery staple', salt);
    expect(k1).toHaveLength(ARGON2_KEY_BYTES);
    expect(k1.equals(k2)).toBe(true);
  });

  it('derives different keys for a different password or salt', async () => {
    const salt = generateSalt();
    const base = await deriveKey('password-one', salt);
    expect(base.equals(await deriveKey('password-two', salt))).toBe(false);
    expect(base.equals(await deriveKey('password-one', generateSalt()))).toBe(false);
  });

  it('derives PIN keys distinct from password keys', async () => {
    const salt = generateSalt();
    expect((await derivePinKey('1234', salt)).equals(await deriveKey('1234', salt))).toBe(false);
  });

  it('starts a new worker after the old one stopped', async () => {
    await stopKdfWorker();
    const salt = generateSalt();
    expect((await derivePinKey('9876', salt)).equals(referenceKey('9876', salt, PIN_ARGON2_OPS_LIMIT, PIN_ARGON2_MEM_LIMIT))).toBe(true);
  });

  it('round-trips a wrapped database key', async () => {
    const dbKey = Buffer.alloc(32, 7);
    const wrappingKey = await derivePinKey('pw', generateSalt());
    const { nonce, ciphertext } = wrapKey(dbKey, wrappingKey);
    expect(ciphertext.equals(dbKey)).toBe(false);
    expect(unwrapKey(ciphertext, nonce, wrappingKey).equals(dbKey)).toBe(true);
  });

  it('refuses to unwrap with the wrong key or tampered ciphertext', async () => {
    const dbKey = Buffer.alloc(32, 9);
    const wrappingKey = await derivePinKey('right', generateSalt());
    const { nonce, ciphertext } = wrapKey(dbKey, wrappingKey);
    const wrong = await derivePinKey('wrong', generateSalt());
    expect(() => unwrapKey(ciphertext, nonce, wrong)).toThrow();
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff;
    expect(() => unwrapKey(tampered, nonce, wrappingKey)).toThrow();
  });

  it('zeroes sensitive buffers', () => {
    const buf = Buffer.from('secret');
    zeroBuffer(buf);
    expect(buf.every((b) => b === 0)).toBe(true);
  });
});
