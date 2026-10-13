/**
 * SFTP Operations Bridge
 * Manages SFTP sessions, file browsing, and transfer queue with progress
 * tracking over SSH connections (reused or standalone).
 */

import type { SFTPWrapper } from 'ssh2';
import { Client } from 'ssh2';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { BrowserWindow } from 'electron';
import { sshManager } from '../ssh';
import { IPC, DEFAULT_SFTP_CONCURRENCY } from '../../shared/constants';
import type { SFTPEntry, TransferItem } from '../../shared/types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TransferState {
  item: TransferItem;
  readStream?: fs.ReadStream | NodeJS.ReadableStream;
  writeStream?: fs.WriteStream | NodeJS.WritableStream;
  paused: boolean;
  aborted: boolean;
}

interface TransferQueueItem {
  id: string;
  connectionId: string;
  localPath: string;
  remotePath: string;
  direction: 'upload' | 'download';
}

// ---------------------------------------------------------------------------
// SFTPManager
// ---------------------------------------------------------------------------

class SFTPManager {
  private connections: Map<string, SFTPWrapper> = new Map();
  private standaloneClients: Map<string, Client> = new Map();
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
  // openSFTPDirect — standalone SFTP session with its own SSH connection
  // -----------------------------------------------------------------------

  async openSFTPDirect(config: {
    hostname: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }): Promise<string> {
    const client = new Client();

    await new Promise<void>((resolve, reject) => {
      client.on('ready', () => resolve());
      client.on('error', (err) => reject(err));

      client.connect({
        host: config.hostname,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
        readyTimeout: 20_000,
      });
    });

    const sftp = await this.sftpFromClient(client);
    const connectionId = `sftp-${uuidv4()}`;
    this.connections.set(connectionId, sftp);
    this.standaloneClients.set(connectionId, client);
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

    // If this was a standalone connection, also tear down the SSH client
    const client = this.standaloneClients.get(connectionId);
    if (client) {
      try {
        client.end();
      } catch {
        // Ignore
      }
      this.standaloneClients.delete(connectionId);
    }
  }

  // -----------------------------------------------------------------------
  // listDirectory
  // -----------------------------------------------------------------------

  async listDirectory(connectionId: string, remotePath: string): Promise<SFTPEntry[]> {
    const sftp = await this.getSFTP(connectionId);

    const list = await new Promise<any[]>((resolve, reject) => {
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
    this.emitTransferProgress(item);

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

  async download(connectionId: string, remotePath: string, localPath: string): Promise<string> {
    // Get remote file size for progress tracking
    const sftp = await this.getSFTP(connectionId);
    const remoteStats = await new Promise<any>((resolve, reject) => {
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
    };

    this.transfers.set(transferId, state);
    this.emitTransferProgress(item);

    this.transferQueue.push({
      id: transferId,
      connectionId,
      localPath,
      remotePath,
      direction: 'download',
    });

    this.processQueue();
    return transferId;
  }

  // -----------------------------------------------------------------------
  // Transfer control
  // -----------------------------------------------------------------------

  pauseTransfer(transferId: string): void {
    const state = this.transfers.get(transferId);
    if (!state || state.paused || state.aborted) return;

    state.paused = true;
    state.item.status = 'paused';

    if (state.readStream && 'pause' in state.readStream) {
      (state.readStream as NodeJS.ReadableStream).pause();
    }

    this.emitTransferProgress(state.item);
  }

  resumeTransfer(transferId: string): void {
    const state = this.transfers.get(transferId);
    if (!state || !state.paused || state.aborted) return;

    state.paused = false;
    state.item.status = 'active';

    if (state.readStream && 'resume' in state.readStream) {
      (state.readStream as NodeJS.ReadableStream).resume();
    }

    this.emitTransferProgress(state.item);
  }

  cancelTransfer(transferId: string): void {
    const state = this.transfers.get(transferId);
    if (!state) return;

    state.aborted = true;
    state.item.status = 'failed';
    state.item.error = 'Cancelled by user';

    // Destroy streams to stop I/O
    if (state.readStream && 'destroy' in state.readStream) {
      (state.readStream as any).destroy();
    }
    if (state.writeStream && 'destroy' in state.writeStream) {
      (state.writeStream as any).destroy();
    }

    this.emitTransferProgress(state.item);

    // Clean up partial downloaded file (best effort)
    if (state.item.direction === 'download') {
      fsPromises.unlink(state.item.localPath).catch(() => {});
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
  private toSFTPEntry(item: any): SFTPEntry {
    const attrs = item.attrs ?? {};
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
    const entries = await new Promise<any[]>((resolve, reject) => {
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
      this.emitTransferProgress(state.item);

      const work =
        queueItem.direction === 'upload'
          ? this.executeUpload(queueItem, state)
          : this.executeDownload(queueItem, state);

      work
        .then(() => {
          if (!state.aborted) {
            state.item.status = 'completed';
            state.item.transferred = state.item.size;
            this.emitTransferProgress(state.item);
          }
        })
        .catch((err: Error) => {
          if (!state.aborted) {
            state.item.status = 'failed';
            state.item.error = err.message;
            this.emitTransferProgress(state.item);
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
    return new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(queueItem.localPath);
      const writeStream = sftp.createWriteStream(queueItem.remotePath);

      state.readStream = readStream;
      state.writeStream = writeStream;

      let transferred = 0;

      readStream.on('data', (chunk: Buffer) => {
        if (state.aborted) {
          readStream.destroy();
          writeStream.destroy();
          return;
        }

        transferred += chunk.length;
        state.item.transferred = transferred;
        this.emitTransferProgress(state.item);
      });

      writeStream.on('close', () => {
        if (state.aborted) return;
        resolve();
      });

      readStream.on('error', (err: Error) => {
        writeStream.destroy();
        reject(err);
      });

      writeStream.on('error', (err: Error) => {
        readStream.destroy();
        reject(err);
      });

      readStream.pipe(writeStream);
    });
  }

  private async executeDownload(queueItem: TransferQueueItem, state: TransferState): Promise<void> {
    const sftp = await this.getSFTP(queueItem.connectionId);
    return new Promise<void>((resolve, reject) => {
      // Ensure the local directory exists
      const localDir = path.dirname(queueItem.localPath);
      fs.mkdirSync(localDir, { recursive: true });

      const readStream = sftp.createReadStream(queueItem.remotePath);
      const writeStream = fs.createWriteStream(queueItem.localPath);

      state.readStream = readStream;
      state.writeStream = writeStream;

      let transferred = 0;

      readStream.on('data', (chunk: Buffer) => {
        if (state.aborted) {
          readStream.destroy();
          writeStream.destroy();
          return;
        }

        transferred += chunk.length;
        state.item.transferred = transferred;
        this.emitTransferProgress(state.item);
      });

      writeStream.on('close', () => {
        if (state.aborted) return;
        resolve();
      });

      readStream.on('error', (err: Error) => {
        writeStream.destroy();
        reject(err);
      });

      writeStream.on('error', (err: Error) => {
        readStream.destroy();
        reject(err);
      });

      readStream.pipe(writeStream);
    });
  }

  // -----------------------------------------------------------------------
  // IPC progress emission
  // -----------------------------------------------------------------------

  private emitTransferProgress(transfer: TransferItem): void {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(IPC.SFTP_TRANSFER_PROGRESS, { ...transfer });
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
