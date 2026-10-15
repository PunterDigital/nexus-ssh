/**
 * FTP sync backend — uses basic-ftp for plain/TLS file transfer.
 */

import { Client as FTPClient } from 'basic-ftp';
import type { SyncBackend, BackendConfig, FileMetadata } from '../types';
import { joinRemote, locateRemote, normaliseRemoteDir, remoteDirChain } from './remote-dir';

export class FTPSyncBackend implements SyncBackend {
  readonly type = 'ftp' as const;
  readonly displayName = 'FTP';

  private client: FTPClient | null = null;
  private connected = false;
  /** The configured Remote Path ('' = the login directory). */
  private remoteDir = '';
  private remoteDirReady = false;

  async connect(config: BackendConfig): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    const client = new FTPClient();
    client.ftp.verbose = false;

    try {
      await client.access({
        host: config.host ?? 'localhost',
        port: config.port ?? 21,
        user: config.username ?? 'anonymous',
        password: config.password ?? '',
        secure: false,
      });

      this.client = client;
      this.connected = true;
      this.remoteDir = normaliseRemoteDir(config.remotePath);
      this.remoteDirReady = false;
    } catch (err: unknown) {
      client.close();
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`FTP connection failed: ${message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.client || !this.connected) {
      return false;
    }
    try {
      await this.client.pwd();
      return true;
    } catch {
      return false;
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('FTP not connected — call connect() first');
    }

    try {
      await this.ensureRemoteDir();
      await this.client.uploadFrom(localPath, joinRemote(this.remoteDir, remotePath));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`FTP upload failed: ${message}`);
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('FTP not connected — call connect() first');
    }

    try {
      const source = await locateRemote(
        this.remoteDir,
        remotePath,
        async (p) => (await this.metadata(p)) !== null
      );
      await this.client.downloadTo(localPath, source);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`FTP download failed: ${message}`);
    }
  }

  async getRemoteMetadata(remotePath: string): Promise<FileMetadata | null> {
    if (!this.client || !this.connected) {
      throw new Error('FTP not connected — call connect() first');
    }

    const target = joinRemote(this.remoteDir, remotePath);
    const meta = await this.metadata(target);
    // Before #2582 the vault went to the login directory: read it from there until the
    // next push writes it to the configured folder.
    return meta ?? (target === remotePath ? null : await this.metadata(remotePath));
  }

  /** Size and mtime of a remote file, or null if it doesn't exist. */
  private async metadata(remotePath: string): Promise<FileMetadata | null> {
    try {
      const size = await this.client!.size(remotePath);
      const lastModified = await this.client!.lastMod(remotePath);

      return {
        size,
        lastModified,
      };
    } catch (err: unknown) {
      // File not found — return null
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('550') || message.toLowerCase().includes('no such file')) {
        return null;
      }
      throw new Error(`FTP metadata retrieval failed: ${message}`);
    }
  }

  /**
   * Create the Remote Path folder (and its parents). MKD on a folder that already exists
   * fails with 550, which is fine; a folder that really can't be created makes the upload
   * fail with the server's message.
   */
  private async ensureRemoteDir(): Promise<void> {
    if (this.remoteDirReady) return;
    for (const dir of remoteDirChain(this.remoteDir)) {
      await this.client!.sendIgnoringError(`MKD ${dir}`);
    }
    this.remoteDirReady = true;
  }
}
