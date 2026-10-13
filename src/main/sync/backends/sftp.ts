/**
 * SFTP sync backend — uses ssh2 for secure file transfer.
 */

import { Client } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
import type { SyncBackend, BackendConfig, FileMetadata } from '../types';

export class SFTPSyncBackend implements SyncBackend {
  readonly type = 'sftp' as const;
  readonly displayName = 'SFTP';

  private client: Client | null = null;
  private sftp: SFTPWrapper | null = null;
  private connected = false;

  async connect(config: BackendConfig): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    return new Promise<void>((resolve, reject) => {
      const client = new Client();
      const timeout = setTimeout(() => {
        client.destroy();
        reject(new Error('SFTP connection timed out after 30 seconds'));
      }, 30_000);

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          clearTimeout(timeout);
          if (err) {
            client.end();
            reject(new Error(`Failed to open SFTP subsystem: ${err.message}`));
            return;
          }
          this.client = client;
          this.sftp = sftp;
          this.connected = true;
          resolve();
        });
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        this.connected = false;
        reject(new Error(`SFTP connection error: ${err.message}`));
      });

      const connectOpts: Record<string, unknown> = {
        host: config.host ?? 'localhost',
        port: config.port ?? 22,
        username: config.username ?? 'root',
        readyTimeout: 30_000,
      };

      if (config.password) {
        connectOpts.password = config.password;
      }

      // privateKeyId is the actual key content passed through config
      if (config.privateKeyId) {
        connectOpts.privateKey = config.privateKeyId;
      }

      client.connect(connectOpts);
    });
  }

  async disconnect(): Promise<void> {
    this.sftp = null;
    this.connected = false;

    if (this.client) {
      const client = this.client;
      this.client = null;
      return new Promise<void>((resolve) => {
        client.on('close', () => resolve());
        client.end();
        // Safety: resolve after a short delay if close event doesn't fire
        setTimeout(resolve, 2_000);
      });
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.sftp || !this.connected) {
      return false;
    }
    try {
      // Try reading the current directory as a connectivity test
      return await new Promise<boolean>((resolve) => {
        this.sftp!.readdir('.', (err) => {
          resolve(!err);
        });
      });
    } catch {
      return false;
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    if (!this.sftp) {
      throw new Error('SFTP not connected — call connect() first');
    }

    return new Promise<void>((resolve, reject) => {
      this.sftp!.fastPut(localPath, remotePath, (err) => {
        if (err) {
          reject(new Error(`SFTP upload failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    if (!this.sftp) {
      throw new Error('SFTP not connected — call connect() first');
    }

    return new Promise<void>((resolve, reject) => {
      this.sftp!.fastGet(remotePath, localPath, (err) => {
        if (err) {
          reject(new Error(`SFTP download failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  async getRemoteMetadata(remotePath: string): Promise<FileMetadata | null> {
    if (!this.sftp) {
      throw new Error('SFTP not connected — call connect() first');
    }

    return new Promise<FileMetadata | null>((resolve, reject) => {
      this.sftp!.stat(remotePath, (err, stats) => {
        if (err) {
          // File not found is not an error — return null
          if ((err as { code?: unknown }).code === 2 || err.message.includes('No such file')) {
            resolve(null);
          } else {
            reject(new Error(`SFTP stat failed: ${err.message}`));
          }
          return;
        }

        resolve({
          size: stats.size,
          lastModified: new Date(stats.mtime * 1000),
        });
      });
    });
  }
}
