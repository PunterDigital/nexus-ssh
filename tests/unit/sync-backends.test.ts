import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FTPSyncBackend } from '../../src/main/sync/backends/ftp';
import { S3SyncBackend } from '../../src/main/sync/backends/s3';
import { startFtpTestServer, type FtpTestServer } from '../fixtures/ftp-server';
import { startS3TestServer, type S3TestServer } from '../fixtures/s3-server';

// Round trips through the real client libraries (basic-ftp, @aws-sdk/client-s3) against
// local throwaway servers, so dependency upgrades can't silently break vault sync.

let localDir: string;
let source: string;
let payload: Buffer;

beforeAll(() => {
  localDir = mkdtempSync(path.join(tmpdir(), 'nexus-sync-local-'));
  payload = randomBytes(256 * 1024);
  source = path.join(localDir, 'vault.db');
  writeFileSync(source, payload);
});

afterAll(() => rmSync(localDir, { recursive: true, force: true }));

describe('FTP sync backend', () => {
  let remoteDir: string;
  let server: FtpTestServer;
  const creds = { username: 'nexus', password: 'p4ss-w0rd-secret' };

  beforeAll(async () => {
    remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-sync-ftp-'));
    server = await startFtpTestServer({ root: remoteDir, ...creds });
  });

  afterAll(async () => {
    await server.close();
    rmSync(remoteDir, { recursive: true, force: true });
  });

  const connect = async (password = creds.password, remotePath?: string) => {
    const backend = new FTPSyncBackend();
    await backend.connect({
      type: 'ftp',
      host: '127.0.0.1',
      port: server.port,
      username: creds.username,
      password,
      remotePath,
    });
    return backend;
  };

  it('uploads, reads metadata and downloads an identical file', async () => {
    const backend = await connect();
    try {
      expect(await backend.testConnection()).toBe(true);

      await backend.upload(source, 'vault.db');
      expect(readFileSync(path.join(remoteDir, 'vault.db')).equals(payload)).toBe(true);

      const meta = await backend.getRemoteMetadata('vault.db');
      expect(meta?.size).toBe(payload.length);
      expect(meta?.lastModified).toBeInstanceOf(Date);
      expect(Math.abs(meta!.lastModified.getTime() - Date.now())).toBeLessThan(60_000);

      const dest = path.join(localDir, 'from-ftp.db');
      await backend.download('vault.db', dest);
      expect(readFileSync(dest).equals(payload)).toBe(true);
    } finally {
      await backend.disconnect();
    }
  });

  it('reports a missing remote file as null', async () => {
    const backend = await connect();
    try {
      expect(await backend.getRemoteMetadata('nope.db')).toBeNull();
    } finally {
      await backend.disconnect();
    }
  });

  it('keeps the vault in the configured Remote Path, creating the folders', async () => {
    const backend = await connect(creds.password, '/sync/nexus/');
    try {
      await backend.upload(source, 'vault.db');
      expect(readFileSync(path.join(remoteDir, 'sync/nexus/vault.db')).equals(payload)).toBe(true);

      expect((await backend.getRemoteMetadata('vault.db'))?.size).toBe(payload.length);
      const dest = path.join(localDir, 'from-ftp-dir.db');
      await backend.download('vault.db', dest);
      expect(readFileSync(dest).equals(payload)).toBe(true);
    } finally {
      await backend.disconnect();
    }

    // A second connection finds the folder already there.
    const again = await connect(creds.password, '/sync/nexus');
    try {
      await again.upload(source, 'vault.db.salt');
      expect(existsSync(path.join(remoteDir, 'sync/nexus/vault.db.salt'))).toBe(true);
      expect(existsSync(path.join(remoteDir, 'vault.db.salt'))).toBe(false);
    } finally {
      await again.disconnect();
    }
  });

  it('reads a vault synced before Remote Path was honoured, then pushes to the folder', async () => {
    const legacy = randomBytes(1024);
    writeFileSync(path.join(remoteDir, 'old.db'), legacy);
    const backend = await connect(creds.password, 'moved');
    try {
      expect((await backend.getRemoteMetadata('old.db'))?.size).toBe(legacy.length);
      const dest = path.join(localDir, 'old-from-ftp.db');
      await backend.download('old.db', dest);
      expect(readFileSync(dest).equals(legacy)).toBe(true);

      await backend.upload(source, 'old.db');
      expect(readFileSync(path.join(remoteDir, 'moved/old.db')).equals(payload)).toBe(true);
      expect((await backend.getRemoteMetadata('old.db'))?.size).toBe(payload.length);
      await backend.download('old.db', dest);
      expect(readFileSync(dest).equals(payload)).toBe(true);
      // The old copy is left alone (no data is deleted).
      expect(readFileSync(path.join(remoteDir, 'old.db')).equals(legacy)).toBe(true);
    } finally {
      await backend.disconnect();
    }
  });

  it('rejects a wrong password without echoing it in the error', async () => {
    const wrong = 'wrong-password-123';
    const err = await connect(wrong).then(
      () => null,
      (e: Error) => e
    );
    expect(err?.message).toMatch(/FTP connection failed/);
    expect(err?.message).not.toContain(wrong);
  });
});

describe('S3 sync backend', () => {
  let server: S3TestServer;

  beforeAll(async () => {
    server = await startS3TestServer();
  });

  afterAll(() => server.close());

  const connect = async () => {
    const backend = new S3SyncBackend();
    await backend.connect({
      type: 's3',
      endpoint: server.endpoint,
      region: 'us-east-1',
      bucket: 'nexus-test',
      prefix: 'sync/',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    });
    return backend;
  };

  it('uploads, reads metadata and downloads an identical file', async () => {
    const backend = await connect();
    try {
      expect(await backend.testConnection()).toBe(true);

      await backend.upload(source, 'vault.db');
      const stored = server.objects.get('/nexus-test/sync/vault.db');
      expect(stored?.body.equals(payload)).toBe(true);

      const meta = await backend.getRemoteMetadata('vault.db');
      expect(meta?.size).toBe(payload.length);
      expect(meta?.lastModified.getTime()).toBe(stored!.lastModified.getTime());
      expect(meta?.etag).toMatch(/^"[0-9a-f]{32}"$/);

      const dest = path.join(localDir, 'from-s3.db');
      await backend.download('vault.db', dest);
      expect(readFileSync(dest).equals(payload)).toBe(true);
    } finally {
      await backend.disconnect();
    }
  });

  it('reports a missing object as null', async () => {
    const backend = await connect();
    try {
      expect(await backend.getRemoteMetadata('nope.db')).toBeNull();
    } finally {
      await backend.disconnect();
    }
  });
});
