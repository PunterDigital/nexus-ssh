// ============================================================
// Nexus SSH Client — Key Derivation Function Module
// Uses libsodium Argon2id for password → key derivation
// and XSalsa20-Poly1305 for key wrapping.
// ============================================================

const sodium = require('libsodium-wrappers-sumo');
import { existsSync } from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
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

// ------------------------------------------------------------
// Argon2id runs in a worker thread (#5661): about a second of synchronous WASM per call,
// which on the main thread froze the window and every IPC reply. One worker, started on the
// first derivation and stopped after a short idle time (it holds the 256 MiB Argon2 buffer).
// ------------------------------------------------------------

interface Pending {
  resolve(key: Buffer): void;
  reject(err: Error): void;
}

const WORKER_IDLE_MS = 15_000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let idleTimer: NodeJS.Timeout | null = null;
let workerUnavailable = false;

/** For tests: how many derivations ran in the worker, and how many fell back to this thread. */
export const kdfStats = { inWorker: 0, onThisThread: 0 };

/**
 * The worker script: dist/main/kdf/kdf-worker.js next to the bundled main (esbuild builds it
 * as a second entry), or the .ts source when running unbundled (vitest).
 */
function workerScript(): string | null {
  const candidates = [
    path.join(__dirname, 'kdf', 'kdf-worker.js'),
    path.join(__dirname, 'kdf-worker.js'),
    path.join(__dirname, 'kdf-worker.ts'),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function failAll(err: Error): void {
  for (const job of pending.values()) job.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable) return null;
  const script = workerScript();
  if (!script) {
    workerUnavailable = true;
    return null;
  }
  const w = new Worker(script);
  w.unref(); // never keeps the app (or a test run) alive
  w.on('message', (msg: { id: number; key?: Uint8Array; error?: string }) => {
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    if (msg.key) {
      const key = Buffer.from(msg.key);
      msg.key.fill(0);
      job.resolve(key);
    } else {
      job.reject(new Error(msg.error ?? 'Key derivation failed'));
    }
    scheduleIdleStop();
  });
  w.on('error', (err) => {
    if (worker === w) worker = null;
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  w.on('exit', () => {
    if (worker === w) worker = null;
    failAll(new Error('Key derivation worker stopped'));
  });
  worker = w;
  return w;
}

function scheduleIdleStop(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (pending.size > 0) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending.size === 0 && worker) {
      const w = worker;
      worker = null;
      void w.terminate();
    }
  }, WORKER_IDLE_MS);
  idleTimer.unref();
}

/**
 * Start the worker and let it load libsodium now, so the next unlock doesn't wait for that
 * (~0.5 s: a thread plus the 1.5 MB WASM). Called at start-up and on lock. A warm worker that
 * hasn't derived anything holds only libsodium; the idle stop starts after a derivation.
 */
export function warmKdfWorker(): void {
  try {
    getWorker()?.postMessage({ warm: true });
  } catch {
    workerUnavailable = true;
  }
}

/** Stop the worker now (tests; app quit doesn't need it, the worker is unref'd). */
export async function stopKdfWorker(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const w = worker;
  worker = null;
  if (w) await w.terminate();
}

function pwhashSync(secret: string, salt: Buffer, opsLimit: number, memLimit: number): Buffer {
  const raw = sodium.crypto_pwhash(
    ARGON2_KEY_BYTES,
    secret,
    new Uint8Array(salt),
    opsLimit,
    memLimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return Buffer.from(raw);
}

async function pwhash(
  secret: string,
  salt: Buffer,
  opsLimit: number,
  memLimit: number,
): Promise<Buffer> {
  let w: Worker | null = null;
  try {
    w = getWorker();
  } catch {
    workerUnavailable = true;
  }
  if (!w) {
    // No worker script (should not happen in a build): same result, on this thread.
    await sodium.ready;
    kdfStats.onThisThread++;
    return pwhashSync(secret, salt, opsLimit, memLimit);
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const id = nextId++;
  const key = await new Promise<Buffer>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w!.postMessage({
      id,
      password: secret,
      salt: new Uint8Array(salt),
      keyBytes: ARGON2_KEY_BYTES,
      opsLimit,
      memLimit,
    });
  });
  kdfStats.inWorker++;
  return key;
}

/**
 * Derive a 32-byte encryption key from a master password using Argon2id, off the main thread.
 *
 * Parameters: OpsLimit 3, MemLimit 256 MiB (matches constants). Byte-identical to
 * `sodium.crypto_pwhash` with the same inputs (tests/unit/kdf.test.ts), so vaults open as before.
 */
export function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return pwhash(password, salt, ARGON2_OPS_LIMIT, ARGON2_MEM_LIMIT);
}

/**
 * Derive a 32-byte key from a PIN with lighter Argon2id parameters, off the main thread.
 *
 * Parameters: OpsLimit 1, MemLimit 64 MiB.
 */
export function derivePinKey(pin: string, salt: Buffer): Promise<Buffer> {
  return pwhash(pin, salt, PIN_ARGON2_OPS_LIMIT, PIN_ARGON2_MEM_LIMIT);
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
