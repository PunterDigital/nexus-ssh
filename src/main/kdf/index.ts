// ============================================================
// Nexus SSH Client — Key Derivation Function Module
// Uses libsodium Argon2id for password → key derivation
// and XSalsa20-Poly1305 for key wrapping.
// ============================================================

const sodium = require('libsodium-wrappers-sumo');
import {
  ARGON2_OPS_LIMIT,
  ARGON2_MEM_LIMIT,
  ARGON2_SALT_BYTES,
  ARGON2_KEY_BYTES,
  PIN_ARGON2_OPS_LIMIT,
  PIN_ARGON2_MEM_LIMIT,
} from '../../shared/constants';

/**
 * Initialise libsodium. Must be called once before any other KDF function.
 */
export async function initSodium(): Promise<void> {
  await sodium.ready;
}

/**
 * Generate a cryptographically-random 16-byte salt.
 */
export function generateSalt(): Buffer {
  const raw = sodium.randombytes_buf(ARGON2_SALT_BYTES);
  return Buffer.from(raw);
}

/**
 * Derive a 32-byte encryption key from a master password using Argon2id.
 *
 * Parameters: OpsLimit 3, MemLimit 256 MiB (matches constants).
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  const raw = sodium.crypto_pwhash(
    ARGON2_KEY_BYTES,
    password,
    new Uint8Array(salt),
    ARGON2_OPS_LIMIT,
    ARGON2_MEM_LIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return Buffer.from(raw);
}

/**
 * Derive a 32-byte key from a PIN with lighter Argon2id parameters.
 *
 * Parameters: OpsLimit 1, MemLimit 64 MiB.
 */
export function derivePinKey(pin: string, salt: Buffer): Buffer {
  const raw = sodium.crypto_pwhash(
    ARGON2_KEY_BYTES,
    pin,
    new Uint8Array(salt),
    PIN_ARGON2_OPS_LIMIT,
    PIN_ARGON2_MEM_LIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return Buffer.from(raw);
}

/**
 * Wrap (encrypt) a database key using XSalsa20-Poly1305 (crypto_secretbox).
 *
 * @returns Object containing the random nonce and ciphertext, both as Buffers.
 */
export function wrapKey(
  dbKey: Buffer,
  wrappingKey: Buffer,
): { nonce: Buffer; ciphertext: Buffer } {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(
    new Uint8Array(dbKey),
    nonce,
    new Uint8Array(wrappingKey),
  );
  return {
    nonce: Buffer.from(nonce),
    ciphertext: Buffer.from(ciphertext),
  };
}

/**
 * Unwrap (decrypt) a database key previously wrapped with {@link wrapKey}.
 *
 * @throws If decryption fails (wrong key or tampered ciphertext).
 */
export function unwrapKey(
  ciphertext: Buffer,
  nonce: Buffer,
  wrappingKey: Buffer,
): Buffer {
  const plaintext = sodium.crypto_secretbox_open_easy(
    new Uint8Array(ciphertext),
    new Uint8Array(nonce),
    new Uint8Array(wrappingKey),
  );
  return Buffer.from(plaintext);
}

/**
 * Securely zero-fill a Buffer so sensitive material does not linger in memory.
 */
export function zeroBuffer(buf: Buffer): void {
  buf.fill(0);
}
