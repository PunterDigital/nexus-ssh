import { create } from 'zustand';
import type { SFTPEntry, TransferItem } from '../../shared/types';

// ============================================================
// SFTP Store — manages SFTP file browsing and transfers
// ============================================================

export type SortField = 'filename' | 'size' | 'modifyTime' | 'permissions';
export type SortDirection = 'asc' | 'desc';

export interface SFTPState {
  // Active session for SFTP
  activeSessionId: string | null;

  // Local browser
  localPath: string;
  localFiles: SFTPEntry[];
  localLoading: boolean;

  // Remote browser
  remotePath: string;
  remoteFiles: SFTPEntry[];
  remoteLoading: boolean;

  // Display options
  showHidden: boolean;
  sortBy: SortField;
  sortDir: SortDirection;

  // Transfers
  transfers: TransferItem[];

  // Selection
  selectedLocalFiles: string[];
  selectedRemoteFiles: string[];

  // Error
  error: string | null;
}

export interface SFTPActions {
  // Session
  setActiveSessionId: (sessionId: string | null) => void;

  // Local navigation
  navigateLocal: (path: string) => void;
  refreshLocal: () => void;
  setLocalFiles: (files: SFTPEntry[]) => void;

  // Remote navigation
  navigateRemote: (path: string) => Promise<void>;
  refreshRemote: () => Promise<void>;

  // Display
  toggleHidden: () => void;
  setSortBy: (field: SortField) => void;
  toggleSortDir: () => void;

  // Transfers
  addTransfer: (transfer: TransferItem) => void;
  updateTransferProgress: (
    id: string,
    transferred: number,
    size?: number,
    status?: TransferItem['status'],
  ) => void;
  pauseTransfer: (id: string) => void;
  resumeTransfer: (id: string) => void;
  resumeTransferLocal: (id: string) => void;
  cancelTransfer: (id: string) => void;
  completeTransfer: (id: string) => void;
  failTransfer: (id: string, error: string) => void;
  clearCompletedTransfers: () => void;

  // Selection
  setSelectedLocalFiles: (filenames: string[]) => void;
  setSelectedRemoteFiles: (filenames: string[]) => void;

  // Upload/Download
  uploadFiles: (localPaths: string[], remotePath: string) => Promise<void>;
  downloadFiles: (remotePaths: string[], localPath: string) => Promise<void>;

  // Remote operations
  createRemoteDirectory: (path: string) => Promise<void>;
  deleteRemoteFile: (path: string, isDirectory?: boolean) => Promise<void>;
  renameRemoteFile: (oldPath: string, newPath: string) => Promise<void>;

  // Reset
  reset: () => void;
}

const initialState: SFTPState = {
  activeSessionId: null,
  localPath: navigator.platform?.startsWith('Win') ? 'C:\\' : '/',
  localFiles: [],
  localLoading: false,
  remotePath: '/',
  remoteFiles: [],
  remoteLoading: false,
  showHidden: false,
  sortBy: 'filename',
  sortDir: 'asc',
  transfers: [],
  selectedLocalFiles: [],
  selectedRemoteFiles: [],
  error: null,
};

/**
 * Sort SFTP entries: directories first, then by the chosen field.
 */
function sortEntries(entries: SFTPEntry[], sortBy: SortField, sortDir: SortDirection, showHidden: boolean): SFTPEntry[] {
  let filtered = entries;
  if (!showHidden) {
    filtered = entries.filter((e) => !e.filename.startsWith('.'));
  }

  return [...filtered].sort((a, b) => {
    // Directories always come first
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    let cmp = 0;
    switch (sortBy) {
      case 'filename':
        cmp = a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' });
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'modifyTime':
        cmp = a.modifyTime - b.modifyTime;
        break;
      case 'permissions':
        cmp = a.permissions - b.permissions;
        break;
    }

    return sortDir === 'asc' ? cmp : -cmp;
  });
}

export const useSFTPStore = create<SFTPState & SFTPActions>()((set, get) => ({
  ...initialState,

  // ── Session ────────────────────────────────────────────────

  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),

  // ── Local navigation ───────────────────────────────────────

  navigateLocal: async (path) => {
    set({ localPath: path, localLoading: true, selectedLocalFiles: [], error: null });
    try {
      const files = (await window.nexus.fs.list(path)) as SFTPEntry[];
      const { sortBy, sortDir, showHidden } = get();
      set({
        localFiles: sortEntries(files, sortBy, sortDir, showHidden),
        localLoading: false,
      });
    } catch (err) {
      set({
        localLoading: false,
        error: `Failed to list local directory: ${(err as Error).message}`,
      });
    }
  },

  refreshLocal: () => {
    const { localPath } = get();
    get().navigateLocal(localPath);
  },

  setLocalFiles: (files) => {
    const { sortBy, sortDir, showHidden } = get();
    set({ localFiles: sortEntries(files, sortBy, sortDir, showHidden) });
  },

  // ── Remote navigation ──────────────────────────────────────

  navigateRemote: async (path) => {
    const { activeSessionId, sortBy, sortDir, showHidden } = get();
    if (!activeSessionId) return;

    set({ remoteLoading: true, remotePath: path, selectedRemoteFiles: [], error: null });
    try {
      const files = await window.nexus.sftp.list(activeSessionId, path) as SFTPEntry[];
      set({
        remoteFiles: sortEntries(files, sortBy, sortDir, showHidden),
        remoteLoading: false,
      });
    } catch (err) {
      set({
        remoteLoading: false,
        error: (err as Error).message,
      });
    }
  },

  refreshRemote: async () => {
    const { remotePath } = get();
    await get().navigateRemote(remotePath);
  },

  // ── Display ────────────────────────────────────────────────

  toggleHidden: () => {
    set((state) => {
      const showHidden = !state.showHidden;
      return {
        showHidden,
        localFiles: sortEntries(state.localFiles, state.sortBy, state.sortDir, showHidden),
        remoteFiles: sortEntries(state.remoteFiles, state.sortBy, state.sortDir, showHidden),
      };
    });
  },

  setSortBy: (field) => {
    set((state) => ({
      sortBy: field,
      localFiles: sortEntries(state.localFiles, field, state.sortDir, state.showHidden),
      remoteFiles: sortEntries(state.remoteFiles, field, state.sortDir, state.showHidden),
    }));
  },

  toggleSortDir: () => {
    set((state) => {
      const sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      return {
        sortDir,
        localFiles: sortEntries(state.localFiles, state.sortBy, sortDir, state.showHidden),
        remoteFiles: sortEntries(state.remoteFiles, state.sortBy, sortDir, state.showHidden),
      };
    });
  },

  // ── Transfers ──────────────────────────────────────────────

  addTransfer: (transfer) =>
    set((state) => ({ transfers: [...state.transfers, transfer] })),

  updateTransferProgress: (id, transferred, size, status) =>
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === id
          ? {
              ...t,
              transferred,
              size: typeof size === 'number' && size > 0 ? size : t.size,
              status: status ?? ('active' as const),
            }
          : t
      ),
    })),

  // Pause/resume/cancel go to the main process, which owns the streams. The
  // status flip here is optimistic; the next progress event confirms it.
  pauseTransfer: (id) => {
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === id ? { ...t, status: 'paused' as const } : t
      ),
    }));
    window.nexus.sftp.pauseTransfer(id).catch((err: Error) => {
      console.error('Pause failed:', err.message);
      get().resumeTransferLocal(id);
    });
  },

  resumeTransfer: (id) => {
    get().resumeTransferLocal(id);
    window.nexus.sftp.resumeTransfer(id).catch((err: Error) => {
      console.error('Resume failed:', err.message);
    });
  },

  resumeTransferLocal: (id) =>
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === id && t.status === 'paused' ? { ...t, status: 'active' as const } : t
      ),
    })),

  cancelTransfer: (id) => {
    set((state) => ({
      transfers: state.transfers.filter((t) => t.id !== id),
    }));
    window.nexus.sftp.cancelTransfer(id).catch((err: Error) => {
      console.error('Cancel failed:', err.message);
    });
  },

  completeTransfer: (id) =>
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === id ? { ...t, status: 'completed' as const, transferred: t.size } : t
      ),
    })),

  failTransfer: (id, error) =>
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === id ? { ...t, status: 'failed' as const, error } : t
      ),
    })),

  clearCompletedTransfers: () =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.status !== 'completed'),
    })),

  // ── Selection ──────────────────────────────────────────────

  setSelectedLocalFiles: (filenames) => set({ selectedLocalFiles: filenames }),
  setSelectedRemoteFiles: (filenames) => set({ selectedRemoteFiles: filenames }),

  // ── Upload/Download ────────────────────────────────────────

  uploadFiles: async (localPaths, remotePath) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;

    for (const localPath of localPaths) {
      const filename = localPath.split(/[\\/]/).pop() ?? localPath;
      const remoteTarget = `${remotePath}/${filename}`.replace(/\/+/g, '/');

      try {
        // Get the backend's transferId — the backend tracks progress under this id
        const transferId = (await window.nexus.sftp.upload(
          activeSessionId,
          localPath,
          remoteTarget,
        )) as string;

        // Create local transfer entry using the same id so progress events match
        const transfer: TransferItem = {
          id: transferId,
          localPath,
          remotePath: remoteTarget,
          direction: 'upload',
          size: 0,
          transferred: 0,
          status: 'queued',
        };
        get().addTransfer(transfer);
      } catch (err) {
        console.error('Upload failed to queue:', (err as Error).message);
      }
    }

    // Refresh the remote pane if we uploaded to the currently-viewed directory
    if (get().remotePath === remotePath) {
      // Small delay so the backend has time to actually finish
      setTimeout(() => {
        if (get().remotePath === remotePath) {
          get().refreshRemote();
        }
      }, 500);
    }
  },

  downloadFiles: async (remotePaths, localPath) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;

    for (const remoteFilePath of remotePaths) {
      const filename = remoteFilePath.split('/').pop() ?? remoteFilePath;
      const localTarget = `${localPath}/${filename}`;

      try {
        const transferId = (await window.nexus.sftp.download(
          activeSessionId,
          remoteFilePath,
          localTarget,
        )) as string;

        const transfer: TransferItem = {
          id: transferId,
          localPath: localTarget,
          remotePath: remoteFilePath,
          direction: 'download',
          size: 0,
          transferred: 0,
          status: 'queued',
        };
        get().addTransfer(transfer);
      } catch (err) {
        console.error('Download failed to queue:', (err as Error).message);
      }
    }

    // Refresh the local pane after a short delay
    if (get().localPath === localPath) {
      setTimeout(() => {
        if (get().localPath === localPath) {
          get().refreshLocal();
        }
      }, 500);
    }
  },

  // ── Remote operations ──────────────────────────────────────

  createRemoteDirectory: async (path) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    await window.nexus.sftp.mkdir(activeSessionId, path);
    await get().refreshRemote();
  },

  deleteRemoteFile: async (path, isDirectory = false) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    await window.nexus.sftp.delete(activeSessionId, path, isDirectory);
    await get().refreshRemote();
  },

  renameRemoteFile: async (oldPath, newPath) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    await window.nexus.sftp.rename(activeSessionId, oldPath, newPath);
    await get().refreshRemote();
  },

  // ── Reset ──────────────────────────────────────────────────

  reset: () => set(initialState),
}));
