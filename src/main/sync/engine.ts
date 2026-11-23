/**
 * Sync orchestration engine — coordinates vault file sync across pluggable backends.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { BrowserWindow } from 'electron';
import { IPC, VAULT_SALT_EXTENSION, VAULT_FILE_EXTENSION } from '@shared/constants';
import type { BackendConfig, SyncBackendType } from '@shared/types';
import type { FileMetadata, SyncBackend, SyncStatus } from './types';
import { SFTPSyncBackend } from './backends/sftp';
import { FilesystemSyncBackend } from './backends/filesystem';
// The FTP and S3 backends (with basic-ftp and @aws-sdk/client-s3, ~170 ms to load) are required
// on first use, not at start-up: most vaults never sync that way (#5665). Plain require(), as
// for electron-updater. (vitest can't require() our .ts sources, so tests build those two
// backends directly; SFTP and filesystem stay static: ssh2 loads anyway.)
import { verifyAndSwap, type SyncVault } from './pull-check';

/**
 * The vault engine as a pull/push needs it. Required lazily: the vault module loads the
 * native SQLCipher binding, which the sync unit tests don't need.
 */
function engineVault(): EngineVault {
  const { vaultEngine } = require('../vault/index');
  const openAt = (dbPath: string) =>
    vaultEngine.isUnlocked() && vaultEngine.getVaultPath() === dbPath;
  // The key of the vault the swap closed: reopening it (same salt) then needs no Argon2id (#5661).
  let held: { key: Buffer; salt: string } | null = null;
  const forget = () => {
    held?.key.fill(0);
    held = null;
  };
  return {
    passwordFor: (dbPath) => (openAt(dbPath) ? vaultEngine.getCurrentPassword() : null),
    localInfo: () => vaultEngine.readSyncInfo(),
    inspect: (dbPath, saltPath, password) => vaultEngine.inspectFile(dbPath, saltPath, password),
    lock: () => {
      forget();
      held = vaultEngine.lockKeepingKey();
    },
    unlock: async (dbPath, password) => {
      await vaultEngine.unlock(dbPath, password, held);
      forget();
    },
    forget,
    bumpGenerationIfOpen: async (dbPath) => {
      if (openAt(dbPath)) await vaultEngine.bumpSyncGeneration();
    },
  };
}

type EngineVault = SyncVault & {
  bumpGenerationIfOpen(dbPath: string): Promise<void>;
  /** Drop any key kept between lock() and unlock(). */
  forget?(): void;
};

/** True when two listings describe the same remote file (size, mtime, and ETag when both have one). */
export function sameRemoteFile(a: FileMetadata | null, b: FileMetadata | null): boolean {
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  if (new Date(a.lastModified).getTime() !== new Date(b.lastModified).getTime()) return false;
  if (a.etag && b.etag && a.etag !== b.etag) return false;
  return true;
}

class SyncEngine {
  private backend: SyncBackend | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private status: SyncStatus = {
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    direction: 'idle',
  };
  private mainWindow: BrowserWindow | null = null;
  private lastSyncHash: string | null = null;
  /**
   * The remote .db as listed right after the last push or pull. While a listing still matches
   * it, the remote hasn't changed and an auto-sync tick downloads nothing (#5661).
   */
  private lastRemote: FileMetadata | null = null;
  /** A remote .db that detectConflict downloaded and found changed: the next pull uses it. */
  private prefetched: { path: string; hash: string; meta: FileMetadata } | null = null;
  /** Remote .db downloads, counted for tests. */
  downloads = 0;
  /** The vault, replaceable in tests. */
  vault: () => EngineVault = engineVault;

  /**
   * Set the main BrowserWindow so the engine can emit status updates to the renderer.
   */
  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  /**
   * Create the appropriate backend instance for the given type.
   */
  createBackend(type: SyncBackendType): SyncBackend {
    switch (type) {
      case 'sftp':
        return new SFTPSyncBackend();
      case 'ftp':
        return new (require('./backends/ftp').FTPSyncBackend)();
      case 's3':
        return new (require('./backends/s3').S3SyncBackend)();
      case 'filesystem':
        return new FilesystemSyncBackend();
      default:
        throw new Error(`Unsupported sync backend type: ${type}`);
    }
  }

  /**
   * Configure and connect to a sync backend.
   */
  async configure(config: BackendConfig): Promise<void> {
    // Disconnect any existing backend first
    if (this.backend) {
      try {
        await this.backend.disconnect();
      } catch {
        // Ignore disconnect errors during reconfiguration
      }
    }

    this.backend = this.createBackend(config.type);
    await this.backend.connect(config);
    this.lastSyncHash = null;
    this.lastRemote = null;
    await this.dropPrefetched();
  }

  /**
   * Test the current backend connection.
   */
  async testConnection(): Promise<boolean> {
    if (!this.backend) {
      return false;
    }
    try {
      return await this.backend.testConnection();
    } catch {
      return false;
    }
  }

  /**
   * Calculate the SHA-256 hash of a file.
   */
  async calculateFileHash(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Push the local vault to the remote backend.
   *
   * 1. Hash the local .db file
   * 2. Compare with lastSyncHash — skip if identical
   * 3. Upload .db and .salt files
   * 4. Update lastSyncHash and status
   */
  async push(vaultPath: string): Promise<void> {
    if (!this.backend) {
      throw new Error('No sync backend configured');
    }

    // vaultPath already includes the .db extension
    const dbPath = vaultPath;
    const saltPath = vaultPath + VAULT_SALT_EXTENSION;

    this.setStatusSyncing('push');

    try {
      // Hash the local vault database
      const localHash = await this.calculateFileHash(dbPath);

      // Skip if nothing changed since last sync
      if (localHash === this.lastSyncHash) {
        this.setStatusDone(null);
        return;
      }

      // Each pushed copy carries a higher sync generation, so a pull can tell an older
      // copy put back in the sync location from a newer one (#5611).
      await this.vault().bumpGenerationIfOpen(dbPath);
      const pushedHash = await this.calculateFileHash(dbPath);

      const remoteDbName = path.basename(dbPath);
      const remoteSaltName = path.basename(saltPath);

      // Upload both files
      await this.backend.upload(dbPath, remoteDbName);
      await this.backend.upload(saltPath, remoteSaltName);

      this.lastSyncHash = pushedHash;
      this.lastRemote = await this.backend.getRemoteMetadata(remoteDbName).catch(() => null);
      await this.dropPrefetched();
      this.setStatusDone(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatusDone(message);
      throw err;
    }
  }

  /**
   * Pull the remote vault to local.
   *
   * 1. Get remote metadata
   * 2. Compare with local hash
   * 3. If different: download .db and .salt to temp files, check them and swap them in
   *    (`verifyAndSwap`: opens with this vault's password, same vault, not older; the old
   *    files are kept as .bak and put back if the new one won't open, #5611)
   * 4. Update lastSyncHash
   */
  async pull(vaultPath: string): Promise<void> {
    if (!this.backend) {
      throw new Error('No sync backend configured');
    }

    // vaultPath already includes the .db extension
    const dbPath = vaultPath;
    const saltPath = vaultPath + VAULT_SALT_EXTENSION;

    this.setStatusSyncing('pull');

    try {
      const remoteDbName = path.basename(dbPath);
      const remoteSaltName = path.basename(saltPath);

      // Check if remote file exists
      const remoteMeta = await this.backend.getRemoteMetadata(remoteDbName);
      if (!remoteMeta) {
        this.setStatusDone(null);
        return; // Nothing to pull
      }

      // Download to temp files first
      const dir = path.dirname(dbPath);
      const stamp = Date.now();
      const tmpDb = path.join(dir, `.sync_tmp_${stamp}${VAULT_FILE_EXTENSION}`);
      const tmpSalt = path.join(dir, `.sync_tmp_${stamp}${VAULT_SALT_EXTENSION}`);

      const vault = this.vault();
      try {
        // detectConflict may have just downloaded this very file: use it rather than fetch
        // it a second time (#5661).
        const prefetched = this.takePrefetched(remoteMeta);
        let remoteHash: string;
        if (prefetched) {
          await fs.rename(prefetched.path, tmpDb);
          remoteHash = prefetched.hash;
        } else {
          this.downloads++;
          await this.backend.download(remoteDbName, tmpDb);
          remoteHash = await this.calculateFileHash(tmpDb);
        }

        // Skip if identical to what we already have
        if (this.lastSyncHash && remoteHash === this.lastSyncHash) {
          await fs.unlink(tmpDb).catch(() => {});
          this.lastRemote = remoteMeta;
          this.setStatusDone(null);
          return;
        }
        await this.backend.download(remoteSaltName, tmpSalt);

        // Never delete the local vault for a file nobody checked: it must open with this
        // vault's password, be this vault and not be older (#5611).
        await verifyAndSwap(vault, { dbPath, saltPath, tmpDb, tmpSalt });

        this.lastSyncHash = remoteHash;
        this.lastRemote = remoteMeta;
        this.setStatusDone(null);
      } catch (err) {
        // Clean up temp files on error
        await fs.unlink(tmpDb).catch(() => {});
        await fs.unlink(tmpSalt).catch(() => {});
        throw err;
      } finally {
        vault.forget?.();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatusDone(message);
      throw err;
    }
  }

  /**
   * Detect if there's a conflict between local and remote vaults.
   *
   * Returns:
   *  - 'none'        — both match the last sync hash (no changes)
   *  - 'local_only'  — only local has changed
   *  - 'remote_only' — only remote has changed
   *  - 'conflict'    — both local and remote have diverged
   */
  async detectConflict(
    vaultPath: string
  ): Promise<'none' | 'local_only' | 'remote_only' | 'conflict'> {
    if (!this.backend) {
      throw new Error('No sync backend configured');
    }

    // vaultPath already includes the .db extension
    const dbPath = vaultPath;
    const remoteDbName = path.basename(dbPath);

    // Calculate local hash
    let localHash: string;
    try {
      localHash = await this.calculateFileHash(dbPath);
    } catch {
      // Local file doesn't exist — treat remote as the only source
      return 'remote_only';
    }

    // Get remote metadata (we use last modified as a proxy since we can't hash remote directly)
    const remoteMeta = await this.backend.getRemoteMetadata(remoteDbName);
    if (!remoteMeta) {
      // No remote file — only local exists
      return 'local_only';
    }

    // If we've never synced, we can't know who changed — treat as conflict
    if (!this.lastSyncHash) {
      // If local exists and remote exists but we have no baseline, it's a conflict
      return 'conflict';
    }

    const localChanged = localHash !== this.lastSyncHash;

    // The remote is unchanged while its listing matches the one from the last sync: no
    // download (#5661). Otherwise download it once and hash it; if it did change, the pull
    // that follows reuses this download.
    let remoteChanged = false;
    if (!sameRemoteFile(this.lastRemote, remoteMeta)) {
      await this.dropPrefetched();
      const tmpPath = path.join(
        path.dirname(dbPath),
        `.sync_conflict_check_${Date.now()}${VAULT_FILE_EXTENSION}`
      );
      let keep = false;
      try {
        this.downloads++;
        await this.backend.download(remoteDbName, tmpPath);
        const remoteHash = await this.calculateFileHash(tmpPath);
        remoteChanged = remoteHash !== this.lastSyncHash;
        if (!remoteChanged) {
          // Same bytes under a new listing (re-uploaded, touched): remember the new listing.
          this.lastRemote = remoteMeta;
        } else if (!localChanged) {
          this.prefetched = { path: tmpPath, hash: remoteHash, meta: remoteMeta };
          keep = true;
        }
      } finally {
        if (!keep) await fs.unlink(tmpPath).catch(() => {});
      }
    }

    if (localChanged && remoteChanged) return 'conflict';
    if (localChanged) return 'local_only';
    if (remoteChanged) return 'remote_only';
    return 'none';
  }

  /**
   * Start auto-sync on a recurring timer.
   */
  startAutoSync(vaultPath: string, intervalSeconds: number): void {
    this.stopAutoSync();

    if (intervalSeconds <= 0) {
      return; // Manual-only mode
    }

    this.syncTimer = setInterval(async () => {
      if (this.status.syncing) {
        return; // Don't overlap syncs
      }

      try {
        const conflict = await this.detectConflict(vaultPath);

        switch (conflict) {
          case 'none':
            // Nothing to do
            break;
          case 'local_only':
            await this.push(vaultPath);
            break;
          case 'remote_only':
            await this.pull(vaultPath);
            break;
          case 'conflict':
            // Don't auto-resolve conflicts — surface error to the user
            this.status = {
              ...this.status,
              lastError: 'Sync conflict detected — both local and remote vaults have changed. Please resolve manually.',
            };
            this.emitStatus();
            break;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.status = { ...this.status, lastError: message };
        this.emitStatus();
      }
    }, intervalSeconds * 1000);
  }

  /**
   * Stop the auto-sync timer.
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Get the current sync status.
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /**
   * Disconnect the backend and clean up all resources.
   */
  async disconnect(): Promise<void> {
    this.stopAutoSync();

    if (this.backend) {
      try {
        await this.backend.disconnect();
      } catch {
        // Swallow disconnect errors during cleanup
      }
      this.backend = null;
    }

    this.lastSyncHash = null;
    this.lastRemote = null;
    await this.dropPrefetched();
    this.status = { syncing: false, lastSyncAt: null, lastError: null, direction: 'idle' };
    this.emitStatus();
  }

  // --- Private helpers ---

  /** The prefetched download if it is still the file `meta` describes (and forget it). */
  private takePrefetched(meta: FileMetadata): { path: string; hash: string } | null {
    const p = this.prefetched;
    this.prefetched = null;
    if (p && sameRemoteFile(p.meta, meta)) return p;
    if (p) void fs.unlink(p.path).catch(() => {});
    return null;
  }

  private async dropPrefetched(): Promise<void> {
    const p = this.prefetched;
    this.prefetched = null;
    if (p) await fs.unlink(p.path).catch(() => {});
  }

  private lastDirection: 'push' | 'pull' | 'idle' = 'idle';

  private setStatusSyncing(direction: 'push' | 'pull'): void {
    this.status = { ...this.status, syncing: true, direction, lastError: null };
    this.lastDirection = direction;
    this.emitStatus({ state: 'syncing' });
  }

  private setStatusDone(error: string | null): void {
    const finishedDirection = this.lastDirection === 'idle' ? 'push' : this.lastDirection;
    const now = new Date().toISOString();
    this.status = {
      syncing: false,
      lastSyncAt: error ? this.status.lastSyncAt : now,
      lastError: error,
      direction: 'idle',
    };
    // Build a history event so the renderer can append it to its log
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: now,
      direction: finishedDirection,
      outcome: error ? ('error' as const) : ('success' as const),
      details: error ?? `${finishedDirection === 'push' ? 'Pushed' : 'Pulled'} vault to remote`,
    };
    this.emitStatus({ state: error ? 'error' : 'synced', event });
    this.lastDirection = 'idle';
  }

  private emitStatus(extra: { state?: string; event?: unknown } = {}): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC.SYNC_STATUS_UPDATE, {
        ...this.status,
        ...extra,
      });
    }
  }
}

export const syncEngine = new SyncEngine();
