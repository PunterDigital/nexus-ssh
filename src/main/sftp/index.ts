/**
 * SFTP Operations Bridge
 * Manages SFTP sessions, file browsing, and transfer queue with progress
 * tracking over SSH connections (reused or standalone).
 */

import type { Attributes, FileEntry, SFTPWrapper, Stats } from 'ssh2';
import type { Client } from 'ssh2';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { BrowserWindow } from 'electron';
import { sshManager } from '../ssh';
import { IPC, DEFAULT_SFTP_CONCURRENCY } from '../../shared/constants';
import type {
  DownloadConflictChoice,
  SFTPDownloadResult,
  SFTPEntry,
  TransferItem,
} from '../../shared/types';
import { keepBothName, resolveInside, safeLocalName } from './local-name';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TransferState {
  item: TransferItem;
  paused: boolean;
  aborted: boolean;
  /** Wakes the transfer's request loops after a resume or a cancel. */
  wake?: () => void;
  /** When progress was last sent to the renderer, and a pending trailing send (#5659). */
  lastEmitAt?: number;
  emitTimer?: NodeJS.Timeout;
  /**
   * Downloads only: the temp file this transfer created and writes into. It is renamed
   * over the target when the download completes, and it is the only file a cancel or a
   * failure deletes (#5610).
   */
  partPath?: string;
  /** Downloads only: replace an existing target on completion (the user chose Overwrite). */
  overwrite?: boolean;
}

interface TransferQueueItem {
  id: string;
  connectionId: string;
  localPath: string;
  remotePath: string;
  direction: 'upload' | 'download';
}

/**
 * Pipelining (#5659). ssh2's createReadStream/createWriteStream keep one request in flight,
 * so a transfer ran at one chunk per round trip (~0.7 MB/s at 20 ms per request). Like ssh2's
 * own fastGet/fastPut, keep many requests outstanding at their own offsets. 32 KB fits in one
 * request on every server (ssh2 splits larger reads into sequential ones on non-OpenSSH servers).
 */
export const SFTP_CHUNK_SIZE = 32 * 1024;
export const SFTP_REQUESTS_IN_FLIGHT = 64;
/** At most one progress message per transfer in this many ms (plus status changes). */
export const PROGRESS_INTERVAL_MS = 100;

/** A positional read (bytes read, 0 = end of file) or write, as the copy loop sees them. */
type ReadAt = (buf: Buffer, length: number, position: number) => Promise<number>;
type WriteAt = (buf: Buffer, length: number, position: number) => Promise<void>;

function sftpOpen(sftp: SFTPWrapper, remotePath: string, flags: 'r' | 'w'): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    sftp.open(remotePath, flags, (err, handle) => (err ? reject(err) : resolve(handle)))
  );
}

function sftpClose(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve, reject) =>
    sftp.close(handle, (err) => (err ? reject(err) : resolve()))
  );
}

function sftpFstat(sftp: SFTPWrapper, handle: Buffer): Promise<Stats> {
  return new Promise((resolve, reject) =>
    sftp.fstat(handle, (err, stats) => (err ? reject(err) : resolve(stats)))
  );
}

function sftpRead(sftp: SFTPWrapper, handle: Buffer): ReadAt {
  return (buf, length, position) =>
    new Promise((resolve, reject) =>
      sftp.read(handle, buf, 0, length, position, (err, bytesRead) =>
        err ? reject(err) : resolve(bytesRead ?? 0)
      )
    );
}

function sftpWrite(sftp: SFTPWrapper, handle: Buffer): WriteAt {
  return (buf, length, position) =>
    new Promise((resolve, reject) =>
      sftp.write(handle, buf, 0, length, position, (err) => (err ? reject(err) : resolve()))
    );
}

// ---------------------------------------------------------------------------
// SFTPManager
// ---------------------------------------------------------------------------

class SFTPManager {
  private connections: Map<string, SFTPWrapper> = new Map();
  private transfers: Map<string, TransferState> = new Map();
  private transferQueue: TransferQueueItem[] = [];
  private activeTransfers: number = 0;
  private maxConcurrency: number = DEFAULT_SFTP_CONCURRENCY;
  private mainWindow: BrowserWindow | null = null;

  /** Register the main BrowserWindow for IPC transfer progress events. */
  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  // -----------------------------------------------------------------------
  // openSFTP — reuse an existing SSH session
  // -----------------------------------------------------------------------

  async openSFTP(sessionId: string): Promise<string> {
    const client = sshManager.getClient(sessionId);
    if (!client) {
      throw new Error(`No SSH session found for id "${sessionId}"`);
    }

    const sftp = await this.sftpFromClient(client);
    const connectionId = `sftp-${uuidv4()}`;
    this.connections.set(connectionId, sftp);
    return connectionId;
  }

  // -----------------------------------------------------------------------
  // closeSFTP
  // -----------------------------------------------------------------------

  closeSFTP(connectionId: string): void {
    const sftp = this.connections.get(connectionId);
    if (sftp) {
      try {
        sftp.end();
      } catch {
        // Ignore — may already be closed
      }
      this.connections.delete(connectionId);
    }
  }

  // -----------------------------------------------------------------------
  // listDirectory
  // -----------------------------------------------------------------------

  async listDirectory(connectionId: string, remotePath: string): Promise<SFTPEntry[]> {
    const sftp = await this.getSFTP(connectionId);

    const list = await new Promise<FileEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, entries) => {
        if (err) return reject(err);
        resolve(entries ?? []);
      });
    });

    const entries: SFTPEntry[] = list.map((item) => this.toSFTPEntry(item));

    // Sort: directories first, then alphabetical by filename
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' });
    });

    return entries;
  }

  // -----------------------------------------------------------------------
  // mkdir
  // -----------------------------------------------------------------------

  async mkdir(connectionId: string, remotePath: string): Promise<void> {
    const sftp = await this.getSFTP(connectionId);
    return new Promise<void>((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // -----------------------------------------------------------------------
  // deleteItem
  // -----------------------------------------------------------------------

  async deleteItem(connectionId: string, remotePath: string, isDirectory: boolean): Promise<void> {
    const sftp = await this.getSFTP(connectionId);

    if (isDirectory) {
      await this.deleteDirectoryRecursive(sftp, remotePath);
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(remotePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  // -----------------------------------------------------------------------
  // rename
  // -----------------------------------------------------------------------

  async rename(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getSFTP(connectionId);
    return new Promise<void>((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // -----------------------------------------------------------------------
  // stat
  // -----------------------------------------------------------------------

  async stat(connectionId: string, remotePath: string): Promise<SFTPEntry> {
    const sftp = await this.getSFTP(connectionId);
    return new Promise<SFTPEntry>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        const filename = path.posix.basename(remotePath);
        resolve({
          filename,
          longname: '',
          isDirectory: (stats.mode! & 0o40000) !== 0,
          isSymlink: false,
          size: stats.size ?? 0,
          modifyTime: stats.mtime ?? 0,
          accessTime: stats.atime ?? 0,
          permissions: stats.mode ?? 0,
          owner: stats.uid ?? 0,
          group: stats.gid ?? 0,
        });
      });
    });
  }

  // -----------------------------------------------------------------------
  // chmod
  // -----------------------------------------------------------------------

  async chmod(connectionId: string, remotePath: string, mode: number): Promise<void> {
    const sftp = await this.getSFTP(connectionId);
    return new Promise<void>((resolve, reject) => {
      sftp.chmod(remotePath, mode, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // -----------------------------------------------------------------------
  // upload
  // -----------------------------------------------------------------------

  async upload(connectionId: string, localPath: string, remotePath: string): Promise<string> {
    // Get local file size for progress tracking
    const localStats = await fsPromises.stat(localPath);
    const transferId = uuidv4();

    const item: TransferItem = {
      id: transferId,
      localPath,
      remotePath,
      direction: 'upload',
      size: localStats.size,
      transferred: 0,
      status: 'queued',
    };

    const state: TransferState = {
      item,
      paused: false,
      aborted: false,
    };

    this.transfers.set(transferId, state);
    this.emitTransferProgress(state, true);

    this.transferQueue.push({
      id: transferId,
      connectionId,
      localPath,
      remotePath,
      direction: 'upload',
    });

    this.processQueue();
    return transferId;
  }

  // -----------------------------------------------------------------------
  // download
  // -----------------------------------------------------------------------

  /**
   * Queue a download of `remotePath` into the folder `localDir`. Main builds the local name
   * from the remote path (a hostile server picks those names, #5610): it must be one plain
   * file name and land directly in `localDir`. If that name is taken, nothing is queued
   * unless `onExists` says what to do.
   */
  async download(
    connectionId: string,
    remotePath: string,
    localDir: string,
    onExists?: DownloadConflictChoice,
  ): Promise<SFTPDownloadResult> {
    const name = safeLocalName(remotePath);
    const dir = path.resolve(localDir);
    const dirStats = await fsPromises.stat(dir).catch(() => null);
    if (!dirStats?.isDirectory()) throw new Error(`Download folder not found: ${dir}`);

    let localPath = resolveInside(dir, name);
    const taken = (candidate: string) => fs.existsSync(path.join(dir, candidate));
    if (taken(name)) {
      if (!onExists) return { status: 'exists', name };
      if (onExists === 'keep-both') localPath = resolveInside(dir, keepBothName(name, taken));
    }
    const overwrite = onExists === 'overwrite';

    // Get remote file size for progress tracking
    const sftp = await this.getSFTP(connectionId);
    const remoteStats = await new Promise<Stats>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });

    const transferId = uuidv4();

    const item: TransferItem = {
      id: transferId,
      localPath,
      remotePath,
      direction: 'download',
      size: remoteStats.size ?? 0,
      transferred: 0,
      status: 'queued',
    };

    const state: TransferState = {
      item,
      paused: false,
      aborted: false,
      overwrite,
    };

    this.transfers.set(transferId, state);
    this.emitTransferProgress(state, true);

    this.transferQueue.push({
      id: transferId,
      connectionId,
      localPath,
      remotePath,
      direction: 'download',
    });

    this.processQueue();
    return { status: 'queued', transferId, localPath };
  }

  // -----------------------------------------------------------------------
  // Transfer control
  // -----------------------------------------------------------------------

  pauseTransfer(transferId: string): void {
    const state = this.transfers.get(transferId);
    if (!state || state.paused || state.aborted || state.item.status !== 'active') return;

    // The request loops stop taking new chunks; requests already sent still land.
    state.paused = true;
    state.item.status = 'paused';
    this.emitTransferProgress(state, true);
  }

  resumeTransfer(transferId: string): void {
    const state = this.transfers.get(transferId);
    if (!state || !state.paused || state.aborted) return;

    state.paused = false;
    state.item.status = 'active';
    state.wake?.();
    this.emitTransferProgress(state, true);
  }

  cancelTransfer(transferId: string): void {
    const state = this.transfers.get(transferId);
    if (!state || state.aborted) return;
    if (state.item.status === 'completed' || state.item.status === 'failed') return;

    state.aborted = true;
    state.paused = false;
    state.item.status = 'failed';
    state.item.error = 'Cancelled by user';

    // The request loops see `aborted` and stop after the requests already sent; a paused
    // transfer's loops are woken to do so. The transfer then fails and frees its slot.
    state.wake?.();
    this.emitTransferProgress(state, true);

    // Delete the partial download: only the temp file this transfer created, never the
    // target (a queued download that never started has no temp file, #5610).
    if (state.partPath) {
      const part = state.partPath;
      state.partPath = undefined;
      fsPromises.unlink(part).catch(() => {});
    }
  }

  // -----------------------------------------------------------------------
  // getTransfers
  // -----------------------------------------------------------------------

  getTransfers(): TransferItem[] {
    return Array.from(this.transfers.values()).map((s) => ({ ...s.item }));
  }

  // -----------------------------------------------------------------------
  // setMaxConcurrency
  // -----------------------------------------------------------------------

  setMaxConcurrency(max: number): void {
    this.maxConcurrency = Math.max(1, max);
    this.processQueue();
  }

  // -----------------------------------------------------------------------
  // destroyAll
  // -----------------------------------------------------------------------

  destroyAll(): void {
    // Cancel all active transfers
    for (const [id] of this.transfers) {
      this.cancelTransfer(id);
    }
    this.transfers.clear();
    this.transferQueue = [];
    this.activeTransfers = 0;

    // Close all SFTP sessions
    for (const connectionId of Array.from(this.connections.keys())) {
      this.closeSFTP(connectionId);
    }
  }

  // =======================================================================
  // Private helpers
  // =======================================================================

  private async getSFTP(idOrSessionId: string): Promise<SFTPWrapper> {
    // 1. If an SFTP subsystem is already open for this id, reuse it
    const existing = this.connections.get(idOrSessionId);
    if (existing) return existing;

    // 2. Otherwise, treat the id as an SSH sessionId and lazily open an
    //    SFTP subsystem on top of its ssh2 Client.
    const client = sshManager.getClient(idOrSessionId);
    if (!client) {
      throw new Error(`No SSH session or SFTP connection found for id "${idOrSessionId}"`);
    }

    const sftp = await this.sftpFromClient(client);
    this.connections.set(idOrSessionId, sftp);
    return sftp;
  }

  private sftpFromClient(client: Client): Promise<SFTPWrapper> {
    return new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        resolve(sftp);
      });
    });
  }

  /** Map an ssh2 readdir entry to our SFTPEntry type. */
  private toSFTPEntry(item: FileEntry): SFTPEntry {
    const attrs: Partial<Attributes> = item.attrs ?? {};
    const mode = attrs.mode ?? 0;

    return {
      filename: item.filename,
      longname: item.longname ?? '',
      isDirectory: (mode & 0o40000) !== 0,
      isSymlink: (mode & 0o120000) === 0o120000,
      size: attrs.size ?? 0,
      modifyTime: attrs.mtime ?? 0,
      accessTime: attrs.atime ?? 0,
      permissions: mode,
      owner: attrs.uid ?? 0,
      group: attrs.gid ?? 0,
    };
  }

  /** Recursively delete a remote directory and all its contents. */
  private async deleteDirectoryRecursive(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    const entries = await new Promise<FileEntry[]>((resolve, reject) => {
      sftp.readdir(dirPath, (err, list) => {
        if (err) return reject(err);
        resolve(list ?? []);
      });
    });

    for (const entry of entries) {
      const fullPath = path.posix.join(dirPath, entry.filename);
      const mode = entry.attrs?.mode ?? 0;
      const isDir = (mode & 0o40000) !== 0;

      if (isDir) {
        await this.deleteDirectoryRecursive(sftp, fullPath);
      } else {
        await new Promise<void>((resolve, reject) => {
          sftp.unlink(fullPath, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      sftp.rmdir(dirPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // -----------------------------------------------------------------------
  // Transfer queue processing
  // -----------------------------------------------------------------------

  private processQueue(): void {
    while (this.activeTransfers < this.maxConcurrency && this.transferQueue.length > 0) {
      const queueItem = this.transferQueue.shift()!;
      const state = this.transfers.get(queueItem.id);

      // Skip if already cancelled
      if (!state || state.aborted) {
        continue;
      }

      this.activeTransfers++;
      state.item.status = 'active';
      this.emitTransferProgress(state, true);

      const work =
        queueItem.direction === 'upload'
          ? this.executeUpload(queueItem, state)
          : this.executeDownload(queueItem, state);

      work
        .then(() => {
          if (!state.aborted) {
            state.item.status = 'completed';
            state.item.transferred = state.item.size;
            this.emitTransferProgress(state, true);
          }
        })
        .catch((err: Error) => {
          if (!state.aborted) {
            state.item.status = 'failed';
            state.item.error = err.message;
            this.emitTransferProgress(state, true);
          }
        })
        .finally(() => {
          this.activeTransfers--;
          this.processQueue();
        });
    }
  }

  private async executeUpload(queueItem: TransferQueueItem, state: TransferState): Promise<void> {
    const sftp = await this.getSFTP(queueItem.connectionId);
    if (state.aborted) return;
    const local = await fsPromises.open(queueItem.localPath, 'r');
    try {
      const size = (await local.stat()).size;
      state.item.size = size;
      const remote = await sftpOpen(sftp, queueItem.remotePath, 'w');
      try {
        await this.copyPipelined(
          state,
          size,
          async (buf, length, position) =>
            (await local.read(buf, 0, length, position)).bytesRead,
          sftpWrite(sftp, remote)
        );
      } finally {
        await sftpClose(sftp, remote).catch(() => {});
      }
    } finally {
      await local.close().catch(() => {});
    }
  }

  private async executeDownload(queueItem: TransferQueueItem, state: TransferState): Promise<void> {
    const sftp = await this.getSFTP(queueItem.connectionId);
    if (state.aborted) return;
    // Write into a temp file of our own next to the target ('wx': never an existing file),
    // then rename it over the target once everything has arrived.
    const dir = path.dirname(queueItem.localPath);
    const part = path.join(dir, `.nexus-download-${queueItem.id}.part`);
    try {
      const local = await fsPromises.open(part, 'wx');
      state.partPath = part;
      try {
        const remote = await sftpOpen(sftp, queueItem.remotePath, 'r');
        try {
          const size = (await sftpFstat(sftp, remote)).size ?? state.item.size;
          state.item.size = size;
          await this.copyPipelined(state, size, sftpRead(sftp, remote), async (buf, length, position) => {
            await local.write(buf, 0, length, position);
          });
        } finally {
          await sftpClose(sftp, remote).catch(() => {});
        }
      } finally {
        await local.close().catch(() => {});
      }
      if (state.aborted) throw new Error('Cancelled by user');
      let target = queueItem.localPath;
      if (!state.overwrite && fs.existsSync(target)) {
        // Someone created the file while we downloaded: keep both rather than replace it.
        const taken = (candidate: string) => fs.existsSync(path.join(dir, candidate));
        target = resolveInside(dir, keepBothName(path.basename(target), taken));
        state.item.localPath = target;
      }
      await fsPromises.rename(part, target);
      state.partPath = undefined;
    } catch (err) {
      // The temp file's name is ours alone (transfer id), so removing it is always safe.
      state.partPath = undefined;
      await fsPromises.unlink(part).catch(() => {});
      throw err;
    }
  }

  /**
   * Copy `size` bytes from `readAt` to `writeAt` at the same offsets, with up to
   * SFTP_REQUESTS_IN_FLIGHT chunks outstanding (#5659). Writes land out of order, which
   * positional writes allow. A pause stops new chunks (sent ones still land); a cancel stops
   * them too and rejects once the outstanding ones have settled. A source that ends early
   * (the file shrank) ends the copy at that point.
   */
  private async copyPipelined(
    state: TransferState,
    size: number,
    readAt: ReadAt,
    writeAt: WriteAt
  ): Promise<void> {
    let next = 0; // next offset to hand out
    let end = size; // lowered if the source turns out shorter
    let transferred = 0;
    let failure: Error | null = null;
    let wakeUp: (() => void) | null = null;
    let wakePromise: Promise<void> | null = null;
    state.wake = () => {
      const w = wakeUp;
      wakeUp = null;
      wakePromise = null;
      w?.();
    };
    const waitWhilePaused = async () => {
      while (state.paused && !state.aborted && !failure) {
        wakePromise ??= new Promise<void>((r) => (wakeUp = r));
        await wakePromise;
      }
    };

    const worker = async (): Promise<void> => {
      const buf = Buffer.allocUnsafe(SFTP_CHUNK_SIZE);
      for (;;) {
        await waitWhilePaused();
        if (state.aborted || failure || next >= end) return;
        const start = next;
        const length = Math.min(SFTP_CHUNK_SIZE, end - start);
        next += length;
        try {
          // A short read (allowed by the protocol) is continued until the chunk is full.
          let got = 0;
          while (got < length) {
            const n = await readAt(buf.subarray(got), length - got, start + got);
            if (n === 0) break;
            got += n;
          }
          if (got < length) end = Math.min(end, start + got); // the source ended early
          if (got > 0) await writeAt(buf, got, start);
          if (state.aborted) return;
          transferred += got;
          state.item.transferred = transferred;
          this.emitTransferProgress(state);
        } catch (err) {
          failure ??= err as Error;
          state.wake?.();
          return;
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: SFTP_REQUESTS_IN_FLIGHT }, worker));
    } finally {
      state.wake = undefined;
    }
    if (state.aborted) throw new Error('Cancelled by user');
    if (failure) throw failure;
    state.item.size = Math.min(size, end);
  }

  // -----------------------------------------------------------------------
  // IPC progress emission
  // -----------------------------------------------------------------------

  /**
   * Send the transfer's state to the renderer: at once for status changes (`force`), and at
   * most every PROGRESS_INTERVAL_MS for byte counts, with a trailing send so the last count
   * isn't lost (#5659: it used to be one IPC message per chunk).
   */
  private emitTransferProgress(state: TransferState, force = false): void {
    const now = Date.now();
    const due = (state.lastEmitAt ?? 0) + PROGRESS_INTERVAL_MS;
    if (!force && now < due) {
      state.emitTimer ??= setTimeout(() => {
        state.emitTimer = undefined;
        this.emitTransferProgress(state, true);
      }, due - now);
      return;
    }
    if (state.emitTimer) {
      clearTimeout(state.emitTimer);
      state.emitTimer = undefined;
    }
    state.lastEmitAt = now;
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(IPC.SFTP_TRANSFER_PROGRESS, { ...state.item });
      }
    } catch {
      // Window may have been destroyed between check and send
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const sftpManager = new SFTPManager();
