// ============================================================
// Argon2id off the main thread (#5661).
//
// libsodium's crypto_pwhash is synchronous: with the vault's parameters (ops 3, 256 MiB) it
// takes about a second in WASM, and on Electron's main thread that froze the window and held
// every IPC reply. kdf/index.ts runs it here instead, in a worker_threads Worker.
//
// Self-contained on purpose: esbuild builds this file as its own entry
// (dist/main/kdf/kdf-worker.js), and vitest runs the .ts source directly (Node strips the
// types), so it may only require libsodium and Node built-ins. Electron's Node has no
// crypto.argon2 (BoringSSL), so libsodium stays the implementation.
// ============================================================

// No import/export here: either would make Node load the .ts source as ESM (no `require`).
const kdfWorkerPort = require('node:worker_threads').parentPort;
const kdfWorkerSodium = require('libsodium-wrappers-sumo');

interface KdfDeriveRequest {
  id: number;
  password: string;
  salt: Uint8Array;
  keyBytes: number;
  opsLimit: number;
  memLimit: number;
}

const kdfWorkerReady: Promise<void> = kdfWorkerSodium.ready;

kdfWorkerPort.on('message', async (req: KdfDeriveRequest | { warm: true }) => {
  if ('warm' in req) {
    // Load libsodium ahead of the first derivation (warmKdfWorker). No reply.
    await kdfWorkerReady;
    return;
  }
  try {
    await kdfWorkerReady;
    const key: Uint8Array = kdfWorkerSodium.crypto_pwhash(
      req.keyBytes,
      req.password,
      req.salt,
      req.opsLimit,
      req.memLimit,
      kdfWorkerSodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    // postMessage copies the 32 bytes, so this copy can be wiped straight away.
    kdfWorkerPort.postMessage({ id: req.id, key });
    key.fill(0);
  } catch (err) {
    kdfWorkerPort.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
});
