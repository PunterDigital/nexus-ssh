/**
 * Sync orchestration engine — coordinates vault file sync across pluggable backends.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { IPC, VAULT_SALT_EXTENSION, VAULT_FILE_EXTENSION } from '@shared/constants';
import type { BackendConfig, SyncBackendType } from '@shared/types';
import type { SyncBackend, SyncStatus } from './types';
import { SFTPSyncBackend } from './backends/sftp';
import { FTPSyncBackend } from './backends/ftp';
import { S3SyncBackend } from './backends/s3';
import { FilesystemSyncBackend } from './backends/filesystem';

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
        return new FTPSyncBackend();
      case 's3':
        return new S3SyncBackend();
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

      const remoteDbName = path.basename(dbPath);
      const remoteSaltName = path.basename(saltPath);

      // Upload both files
      await this.backend.upload(dbPath, remoteDbName);
      await this.backend.upload(saltPath, remoteSaltName);

      this.lastSyncHash = localHash;
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
   * 3. If different: download .db and .salt to temp files, then atomically replace local
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

      let reopenNeeded = false;
      let storedPassword: string | null = null;

      try {
        await this.backend.download(remoteDbName, tmpDb);
        await this.backend.download(remoteSaltName, tmpSalt);

        // Skip if identical to what we already have
        const remoteHash = await this.calculateFileHash(tmpDb);
        if (this.lastSyncHash && remoteHash === this.lastSyncHash) {
          await fs.unlink(tmpDb).catch(() => {});
          await fs.unlink(tmpSalt).catch(() => {});
          this.setStatusDone(null);
          return;
        }

        // On Windows (and any OS really) an open SQLCipher handle holds an
        // exclusive lock on the .db file. We need to close the vault before
        // replacing the file, then reopen it with the same password after.
        const { vaultEngine } = require('../vault/index');
        if (
          vaultEngine.isUnlocked &&
          vaultEngine.isUnlocked() &&
          vaultEngine.getVaultPath &&
          vaultEngine.getVaultPath() === dbPath
        ) {
          storedPassword = vaultEngine.getCurrentPassword?.() ?? null;
          if (!storedPassword) {
            throw new Error(
              'Cannot pull while vault is unlocked — password not cached. ' +
              'Lock the vault first, then pull.',
            );
          }
          vaultEngine.lock();
          reopenNeeded = true;
        }

        // Replace local files (remove old, then rename temp)
        await fs.unlink(dbPath).catch(() => {});
        await fs.unlink(saltPath).catch(() => {});
        await fs.rename(tmpDb, dbPath);
        await fs.rename(tmpSalt, saltPath);

        // Reopen the vault if we closed it above
        if (reopenNeeded && storedPassword) {
          await vaultEngine.unlock(dbPath, storedPassword);
        }

        this.lastSyncHash = remoteHash;
        this.setStatusDone(null);
      } catch (err) {
        // Clean up temp files on error
        await fs.unlink(tmpDb).catch(() => {});
        await fs.unlink(tmpSalt).catch(() => {});
        throw err;
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

    // For remote change detection, download to a temp file and hash
    let remoteChanged = false;
    const tmpPath = path.join(
      path.dirname(dbPath),
      `.sync_conflict_check_${Date.now()}${VAULT_FILE_EXTENSION}`
    );

    try {
      await this.backend.download(remoteDbName, tmpPath);
      const remoteHash = await this.calculateFileHash(tmpPath);
      remoteChanged = remoteHash !== this.lastSyncHash;
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
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
    this.status = { syncing: false, lastSyncAt: null, lastError: null, direction: 'idle' };
    this.emitStatus();
  }

  // --- Private helpers ---

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
