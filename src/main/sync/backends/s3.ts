/**
 * S3 sync backend — supports AWS S3 and S3-compatible stores
 * (MinIO, Backblaze B2, Cloudflare R2, DigitalOcean Spaces).
 */

import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import type { SyncBackend, BackendConfig, FileMetadata } from '../types';

export class S3SyncBackend implements SyncBackend {
  readonly type = 's3' as const;
  readonly displayName = 'Amazon S3';

  private client: S3Client | null = null;
  private bucket: string = '';
  private prefix: string = '';
  private connected = false;

  async connect(config: BackendConfig): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    if (!config.bucket) {
      throw new Error('S3 bucket name is required');
    }

    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error('S3 access key and secret key are required');
    }

    const clientConfig: Record<string, unknown> = {
      region: config.region ?? 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };

    // Custom endpoint for S3-compatible stores
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true;
    }

    this.client = new S3Client(clientConfig);
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? '';
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.connected = false;
  }

  async testConnection(): Promise<boolean> {
    if (!this.client || !this.connected) {
      return false;
    }
    try {
      // HeadObject on a non-existent key will throw NotFound which still proves connectivity
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.resolveKey('__nexus_sync_test__'),
        })
      );
      return true;
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      // NotFound or NoSuchKey means S3 is reachable but the key doesn't exist — that's fine
      if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
        return true;
      }
      return false;
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('S3 not connected — call connect() first');
    }

    try {
      const fileStream = createReadStream(localPath);
      const stat = await fs.stat(localPath);

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.resolveKey(remotePath),
          Body: fileStream,
          ContentLength: stat.size,
        })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`S3 upload failed: ${message}`);
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('S3 not connected — call connect() first');
    }

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.resolveKey(remotePath),
        })
      );

      if (!response.Body) {
        throw new Error('S3 returned empty body');
      }

      // Stream the body to a file
      const body = response.Body as Readable;
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        body.on('data', (chunk: Buffer) => chunks.push(chunk));
        body.on('end', () => resolve());
        body.on('error', reject);
      });

      await fs.writeFile(localPath, Buffer.concat(chunks));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`S3 download failed: ${message}`);
    }
  }

  async getRemoteMetadata(remotePath: string): Promise<FileMetadata | null> {
    if (!this.client || !this.connected) {
      throw new Error('S3 not connected — call connect() first');
    }

    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.resolveKey(remotePath),
        })
      );

      return {
        size: response.ContentLength ?? 0,
        lastModified: response.LastModified ?? new Date(0),
        etag: response.ETag ?? undefined,
      };
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
        return null;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`S3 metadata retrieval failed: ${message}`);
    }
  }

  private resolveKey(remotePath: string): string {
    if (this.prefix) {
      // Ensure no double slashes
      const trimmedPrefix = this.prefix.replace(/\/+$/, '');
      const trimmedPath = remotePath.replace(/^\/+/, '');
      return `${trimmedPrefix}/${trimmedPath}`;
    }
    return remotePath;
  }
}
