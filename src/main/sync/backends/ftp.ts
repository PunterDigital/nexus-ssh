/**
 * FTP sync backend — uses basic-ftp for plain/TLS file transfer.
 */

import { Client as FTPClient } from 'basic-ftp';
import type { SyncBackend, BackendConfig, FileMetadata } from '../types';

export class FTPSyncBackend implements SyncBackend {
  readonly type = 'ftp' as const;
  readonly displayName = 'FTP';

  private client: FTPClient | null = null;
  private connected = false;

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
      await this.client.uploadFrom(localPath, remotePath);
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
      await this.client.downloadTo(localPath, remotePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`FTP download failed: ${message}`);
    }
  }

  async getRemoteMetadata(remotePath: string): Promise<FileMetadata | null> {
    if (!this.client || !this.connected) {
      throw new Error('FTP not connected — call connect() first');
    }

    try {
      const size = await this.client.size(remotePath);
      const lastModified = await this.client.lastMod(remotePath);

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
}
