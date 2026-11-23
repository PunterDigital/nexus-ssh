import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
/** Queue a download into `dir` and return its transfer id (fails on a name clash). */
async function download(remote: string, dir: string, onExists?: 'overwrite' | 'keep-both') {
  const result = await sftpManager.download(conn, remote, dir, onExists);
  if (result.status !== 'queued') throw new Error(`not queued: ${JSON.stringify(result)}`);
  return result.transferId;
}
let dirCount = 0;
/** A fresh empty folder inside localDir. */
const freshDir = () => {
  const dir = path.join(localDir, `case-${++dirCount}`);
  mkdirSync(dir);
  return dir;
};
/** A name a hostile server lists: backslashes are legal in SFTP names, separators on Windows. */
const HOSTILE_NAME = '..\\..\\escaped.cmd';

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
  server = await startTestServer({
    root: remoteDir,
    writeDelayMs: 15,
    readDelayMs: 15,
    virtualFiles: { [HOSTILE_NAME]: Buffer.from('echo pwned\r\n') },
  });
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
    const dir = freshDir();
    const dest = path.join(dir, 'remote.bin');
    const id = await download('/remote.bin', dir);
    expect(transfer(id).localPath).toBe(dest);

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
    const cancelDir = freshDir();
    const first = await download('/remote.bin', cancelDir);
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
    // Only the transfer's own temp file existed, and it is gone.
    await waitFor(() => readdirSync(cancelDir).length === 0, 5_000);
  });
});

describe('SFTP download names and existing files (#5610)', () => {
  it('refuses a remote name with backslashes and writes nothing', async () => {
    const listed = await sftpManager.listDirectory(conn, '/');
    expect(listed.map((e) => e.filename)).toContain(HOSTILE_NAME);
    const dir = freshDir();
    await expect(sftpManager.download(conn, '/' + HOSTILE_NAME, dir)).rejects.toThrow(
      /Refused to download .*path separator/
    );
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(path.join(localDir, 'escaped.cmd'))).toBe(false);
    expect(existsSync(path.join(path.dirname(localDir), 'escaped.cmd'))).toBe(false);
  });

  it('refuses a download folder that does not exist', async () => {
    await expect(
      sftpManager.download(conn, '/remote.bin', path.join(localDir, 'missing', 'deeper'))
    ).rejects.toThrow(/folder not found/);
  });

  it('asks before replacing an existing file, then overwrites or keeps both', async () => {
    const dir = freshDir();
    const existing = path.join(dir, 'remote.bin');
    writeFileSync(existing, 'mine');

    expect(await sftpManager.download(conn, '/remote.bin', dir)).toEqual({
      status: 'exists',
      name: 'remote.bin',
    });
    expect(readFileSync(existing, 'utf8')).toBe('mine');

    const both = await download('/remote.bin', dir, 'keep-both');
    expect(transfer(both).localPath).toBe(path.join(dir, 'remote (1).bin'));
    await waitFor(() => transfer(both).status === 'completed');
    expect(readFileSync(existing, 'utf8')).toBe('mine');
    expect(sha(path.join(dir, 'remote (1).bin'))).toBe(sha(path.join(remoteDir, 'remote.bin')));

    const over = await download('/remote.bin', dir, 'overwrite');
    expect(transfer(over).localPath).toBe(existing);
    await waitFor(() => transfer(over).status === 'completed');
    expect(sha(existing)).toBe(sha(path.join(remoteDir, 'remote.bin')));
    expect(readdirSync(dir).sort()).toEqual(['remote (1).bin', 'remote.bin']);
  });

  it('an overwrite cancelled mid-way leaves the original file as it was', async () => {
    const dir = freshDir();
    const existing = path.join(dir, 'remote.bin');
    writeFileSync(existing, 'original');
    const id = await download('/remote.bin', dir, 'overwrite');
    await waitFor(() => transfer(id).transferred > 0);
    sftpManager.cancelTransfer(id);
    await waitFor(() => readdirSync(dir).length === 1, 5_000);
    expect(readFileSync(existing, 'utf8')).toBe('original');
  });

  it('cancelling a queued download never deletes a file it did not create', async () => {
    const dir = freshDir();
    // Hold the only slot with a paused download so the next one stays queued.
    const blocker = await download('/remote.bin', freshDir());
    await waitFor(() => transfer(blocker).transferred > 0);
    sftpManager.pauseTransfer(blocker);

    const existing = path.join(dir, 'remote.bin');
    writeFileSync(existing, 'keep me');
    const queued = await download('/remote.bin', dir, 'overwrite');
    await sleep(200);
    expect(transfer(queued).status).toBe('queued');
    sftpManager.cancelTransfer(queued);
    sftpManager.cancelTransfer(blocker);
    await sleep(300);
    expect(readFileSync(existing, 'utf8')).toBe('keep me');
    expect(readdirSync(dir)).toEqual(['remote.bin']);
  });
});
