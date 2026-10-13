import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// The SFTP manager pulls in the SSH manager, which registers IPC handlers via electron.
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn() } }));

const { sftpManager } = await import('../../src/main/sftp');

const FILE_SIZE = 3 * 1024 * 1024;
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const transfer = (id: string) => sftpManager.getTransfers().find((t) => t.id === id)!;

async function waitFor(cond: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await sleep(20);
  }
}

let localDir: string;
let remoteDir: string;
let server: TestServer;
let conn: string;

beforeAll(async () => {
  localDir = mkdtempSync(path.join(tmpdir(), 'nexus-sftp-local-'));
  remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-sftp-remote-'));
  writeFileSync(path.join(localDir, 'big.bin'), randomBytes(FILE_SIZE));
  writeFileSync(path.join(remoteDir, 'remote.bin'), randomBytes(FILE_SIZE));
  // Slow every request down so a 3 MB transfer takes a few seconds and can be paused mid-way.
  server = await startTestServer({ root: remoteDir, writeDelayMs: 15, readDelayMs: 15 });
  conn = await sftpManager.openSFTPDirect({
    hostname: server.host,
    port: server.port,
    username: server.username,
    password: server.password,
  });
  sftpManager.setMaxConcurrency(1);
});

afterAll(async () => {
  sftpManager.destroyAll();
  await server?.close();
  rmSync(localDir, { recursive: true, force: true });
  rmSync(remoteDir, { recursive: true, force: true });
});

describe('SFTP transfer pause / resume / cancel', () => {
  it('pausing an upload stops bytes moving; resuming finishes an identical file', async () => {
    const src = path.join(localDir, 'big.bin');
    const dest = path.join(remoteDir, 'uploaded.bin');
    const id = await sftpManager.upload(conn, src, '/uploaded.bin');

    await waitFor(() => transfer(id).transferred > 0);
    sftpManager.pauseTransfer(id);
    expect(transfer(id).status).toBe('paused');

    await sleep(300); // let in-flight writes land
    const readAtPause = transfer(id).transferred;
    const writtenAtPause = statSync(dest).size;
    await sleep(800);
    expect(transfer(id).transferred).toBe(readAtPause);
    expect(statSync(dest).size).toBe(writtenAtPause);
    expect(writtenAtPause).toBeLessThan(FILE_SIZE);

    sftpManager.resumeTransfer(id);
    expect(transfer(id).status).toBe('active');
    await waitFor(() => transfer(id).status === 'completed');
    expect(sha(dest)).toBe(sha(src));
  });

  it('pausing a download stops bytes moving; resuming finishes an identical file', async () => {
    const src = path.join(remoteDir, 'remote.bin');
    const dest = path.join(localDir, 'downloaded.bin');
    const id = await sftpManager.download(conn, '/remote.bin', dest);

    await waitFor(() => transfer(id).transferred > 0);
    sftpManager.pauseTransfer(id);
    await sleep(300);
    const readAtPause = transfer(id).transferred;
    await sleep(800);
    expect(transfer(id).transferred).toBe(readAtPause);
    expect(readAtPause).toBeLessThan(FILE_SIZE);

    sftpManager.resumeTransfer(id);
    await waitFor(() => transfer(id).status === 'completed');
    expect(sha(dest)).toBe(sha(src));
  });

  it('cancelling a paused transfer fails it and frees the slot for the next one', async () => {
    const src = path.join(localDir, 'big.bin');
    const first = await sftpManager.download(conn, '/remote.bin', path.join(localDir, 'cancelled.bin'));
    await waitFor(() => transfer(first).transferred > 0);
    sftpManager.pauseTransfer(first);

    // With concurrency 1 this one waits for the slot held by the paused transfer.
    const second = await sftpManager.upload(conn, src, '/after-cancel.bin');
    await sleep(200);
    expect(transfer(second).status).toBe('queued');

    sftpManager.cancelTransfer(first);
    expect(transfer(first).status).toBe('failed');
    expect(transfer(first).error).toBe('Cancelled by user');

    await waitFor(() => transfer(second).status === 'completed');
    expect(sha(path.join(remoteDir, 'after-cancel.bin'))).toBe(sha(src));
    await waitFor(() => !existsSync(path.join(localDir, 'cancelled.bin')), 5_000);
  });
});
