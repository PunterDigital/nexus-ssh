/**
 * Local filesystem sync backend — copies vault files to/from a local directory.
 * Useful for USB drives, network-mounted folders, or local backup directories.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SyncBackend, BackendConfig, FileMetadata } from '../types';

export class FilesystemSyncBackend implements SyncBackend {
  readonly type = 'filesystem' as const;
  readonly displayName = 'Local Filesystem';

  private basePath: string = '';
  private connected = false;

  async connect(config: BackendConfig): Promise<void> {
    if (!config.directoryPath) {
      throw new Error('Filesystem backend requires a directoryPath');
    }

    const dirPath = config.directoryPath;

    // Ensure the target directory exists, create it if not
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to access sync directory: ${message}`);
    }

    // Verify it is actually a directory
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }

    this.basePath = dirPath;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.basePath = '';
  }

  async testConnection(): Promise<boolean> {
    if (!this.connected || !this.basePath) {
      return false;
    }
    try {
      // Write and remove a tiny probe file to verify read/write access
      const probe = path.join(this.basePath, '.nexus_sync_probe');
      await fs.writeFile(probe, 'probe', 'utf-8');
      await fs.unlink(probe);
      return true;
    } catch {
      return false;
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Filesystem backend not connected — call connect() first');
    }

    const destPath = this.resolvePath(remotePath);

    try {
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(localPath, destPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Filesystem upload failed: ${message}`);
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Filesystem backend not connected — call connect() first');
    }

    const srcPath = this.resolvePath(remotePath);

    try {
      // Ensure parent directory of local destination exists
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.copyFile(srcPath, localPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Filesystem download failed: ${message}`);
    }
  }

  async getRemoteMetadata(remotePath: string): Promise<FileMetadata | null> {
    if (!this.connected) {
      throw new Error('Filesystem backend not connected — call connect() first');
    }

    const filePath = this.resolvePath(remotePath);

    try {
      const stat = await fs.stat(filePath);
      return {
        size: stat.size,
        lastModified: stat.mtime,
      };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return null;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Filesystem metadata retrieval failed: ${message}`);
    }
  }

  private resolvePath(remotePath: string): string {
    // remotePath is relative — resolve against basePath
    // Guard against path traversal
    const resolved = path.resolve(this.basePath, remotePath);
    const normalBase = path.resolve(this.basePath);
    if (!resolved.startsWith(normalBase)) {
      throw new Error('Path traversal detected — refusing to access files outside the sync directory');
    }
    return resolved;
  }
}
