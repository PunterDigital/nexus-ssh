import { beforeAll, describe, expect, it } from 'vitest';
import {
  initSodium,
  generateSalt,
  deriveKey,
  derivePinKey,
  wrapKey,
  unwrapKey,
  zeroBuffer,
} from '../../src/main/kdf';
import { ARGON2_KEY_BYTES, ARGON2_SALT_BYTES } from '../../src/shared/constants';

beforeAll(async () => {
  await initSodium();
});

describe('kdf', () => {
  it('generates random salts of the configured length', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).toHaveLength(ARGON2_SALT_BYTES);
    expect(a.equals(b)).toBe(false);
  });

  it('derives the same key for the same password and salt', () => {
    const salt = generateSalt();
    const k1 = deriveKey('correct horse battery staple', salt);
    const k2 = deriveKey('correct horse battery staple', salt);
    expect(k1).toHaveLength(ARGON2_KEY_BYTES);
    expect(k1.equals(k2)).toBe(true);
  });

  it('derives different keys for a different password or salt', () => {
    const salt = generateSalt();
    const base = deriveKey('password-one', salt);
    expect(base.equals(deriveKey('password-two', salt))).toBe(false);
    expect(base.equals(deriveKey('password-one', generateSalt()))).toBe(false);
  });

  it('derives PIN keys distinct from password keys', () => {
    const salt = generateSalt();
    expect(derivePinKey('1234', salt).equals(deriveKey('1234', salt))).toBe(false);
  });

  it('round-trips a wrapped database key', () => {
    const dbKey = Buffer.alloc(32, 7);
    const wrappingKey = deriveKey('pw', generateSalt());
    const { nonce, ciphertext } = wrapKey(dbKey, wrappingKey);
    expect(ciphertext.equals(dbKey)).toBe(false);
    expect(unwrapKey(ciphertext, nonce, wrappingKey).equals(dbKey)).toBe(true);
  });

  it('refuses to unwrap with the wrong key or tampered ciphertext', () => {
    const dbKey = Buffer.alloc(32, 9);
    const wrappingKey = deriveKey('right', generateSalt());
    const { nonce, ciphertext } = wrapKey(dbKey, wrappingKey);
    expect(() => unwrapKey(ciphertext, nonce, deriveKey('wrong', generateSalt()))).toThrow();
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
