/**
 * SFTP sync backend — uses ssh2 for secure file transfer.
 */

import { Client } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
import type { SyncBackend, BackendConfig, FileMetadata, SyncConnectOptions } from '../types';
import { createHostVerifier, createPinnedHostVerifier } from '../../ssh/host-key';

/** Background connections give up after this long. */
const CONNECT_TIMEOUT_MS = 30_000;
/** Interactive connections may wait on the host-key prompt, so they get longer. */
const INTERACTIVE_CONNECT_TIMEOUT_MS = 60_000;

export class SFTPSyncBackend implements SyncBackend {
  readonly type = 'sftp' as const;
  readonly displayName = 'SFTP';

  private client: Client | null = null;
  private sftp: SFTPWrapper | null = null;
  private connected = false;

  /**
   * Connect and open the SFTP subsystem. The server's host key is always checked against
   * known_hosts. Background syncs (the default) never prompt: an unknown or changed key
   * fails the connection. `interactive` (Test Connection in the sync settings) shows the
   * host-key prompt instead, and "Always Accept" pins the key for later background syncs.
   */
  async connect(config: BackendConfig, options: SyncConnectOptions = {}): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    const host = config.host ?? 'localhost';
    const port = config.port ?? 22;
    const interactive = options.interactive === true;
    const prompted = interactive ? createHostVerifier(host, port) : null;
    const pinned = interactive ? null : createPinnedHostVerifier(host, port);
    const timeoutMs = interactive ? INTERACTIVE_CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS;

    const hostKeyError = (): Error | null => {
      const where = `${host}:${port}`;
      if (pinned?.failure === 'changed') {
        return new Error(
          `The SFTP server's host key for ${where} has changed, so vault sync stopped. ` +
            'If you expect the change, use Test Connection in Settings → Vault Sync to review and trust the new key.'
        );
      }
      if (pinned?.failure === 'unknown') {
        return new Error(
          `The SFTP server's host key for ${where} isn't trusted yet. ` +
            'Use Test Connection in Settings → Vault Sync to check and trust it.'
        );
      }
      if (prompted?.rejected) {
        return new Error(`Host key for ${where} was not accepted.`);
      }
      return null;
    };

    return new Promise<void>((resolve, reject) => {
      const client = new Client();
      const timeout = setTimeout(() => {
        prompted?.dismiss();
        client.destroy();
        reject(new Error(`SFTP connection timed out after ${timeoutMs / 1000} seconds`));
      }, timeoutMs);

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
        prompted?.dismiss();
        this.connected = false;
        reject(hostKeyError() ?? new Error(`SFTP connection error: ${err.message}`));
      });

      const connectOpts: Record<string, unknown> = {
        host,
        port,
        username: config.username ?? 'root',
        readyTimeout: timeoutMs,
        hostVerifier: (prompted ?? pinned)!.hostVerifier,
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
