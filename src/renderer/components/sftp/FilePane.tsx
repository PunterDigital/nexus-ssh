import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileSymlink,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderX,
  Laptop,
  LockKeyhole,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type { SFTPEntry } from '../../../shared/types';
import { useShallow } from 'zustand/react/shallow';
import { useSFTPStore, type SortField } from '../../stores/sftp-store';
import { useUIStore } from '../../stores/ui-store';
import { Icon } from '../common/Icon';
import { ContextMenu, type ContextMenuEntry } from '../vault/ContextMenu';
import { Button, Dialog, EmptyState, IconButton, Input, Toolbar, cx } from '../ui';
import { BreadcrumbPath } from './BreadcrumbPath';
import { ChmodDialog, modeToString } from './ChmodDialog';
import { DragDropOverlay } from './DragDropOverlay';

// ============================================================
// FilePane — one side of the SFTP browser (local or remote).
//
// Toolbar: parent folder, the path (breadcrumb / editable), and actions (transfer the
// selection, new folder, show hidden files, refresh). The file list is a multi-select listbox:
// click / Ctrl+click / Shift+click or the arrow keys select, Enter or double-click opens a
// folder (or downloads a remote file), right-click, Shift+F10 or the context-menu key opens the
// row's menu, F2 renames, Delete deletes (remote) and Backspace goes up. Rows drag to the other
// pane to transfer; the remote pane also takes files dropped from the OS. Columns that don't
// fit the pane's width (an @container) are hidden.
// ============================================================

type Side = 'local' | 'remote';

// ── Helpers ─────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '--';
  const date = new Date(timestamp * 1000);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const CODE_EXTS = [
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'c',
  'cpp',
  'h',
  'java',
  'cs',
  'sh',
  'bash',
  'zsh',
  'ps1',
];
const CONFIG_EXTS = ['json', 'yaml', 'yml', 'toml', 'ini', 'xml', 'env', 'conf', 'cfg'];
const TEXT_EXTS = ['log', 'txt', 'md', 'rst', 'csv'];
const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z', 'tgz'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];

/** An icon (and its colour class) per file type, so types are easy to tell apart. */
function getFileIcon(entry: SFTPEntry): { icon: LucideIcon; className: string } {
  if (entry.isDirectory) return { icon: Folder, className: 'text-warning' };
  if (entry.isSymlink) return { icon: FileSymlink, className: 'text-accent' };
  const ext = entry.filename.split('.').pop()?.toLowerCase() ?? '';
  const icon = CODE_EXTS.includes(ext)
    ? FileCode
    : CONFIG_EXTS.includes(ext)
      ? FileCog
      : TEXT_EXTS.includes(ext)
        ? FileText
        : ARCHIVE_EXTS.includes(ext)
          ? FileArchive
          : IMAGE_EXTS.includes(ext)
            ? FileImage
            : File;
  return { icon, className: 'text-fg-muted' };
}

/** Sentinel path for the Windows drive list ("This PC"). */
export const DRIVES_ROOT = '__drives__';

function joinPath(base: string, name: string, side: Side): string {
  if (side === 'remote') return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
  // At the drives root, a drive like "C:" opens "C:\"
  if (base === DRIVES_ROOT) return name.endsWith(':') ? `${name}\\` : name;
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

function parentPath(path: string, side: Side): string {
  if (side === 'remote') {
    const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
    parts.pop();
    return parts.length === 0 ? '/' : '/' + parts.join('/');
  }
  if (path === DRIVES_ROOT) return DRIVES_ROOT;

  const isWindows = /\\|^[A-Za-z]:/.test(path);
  const sep = isWindows ? '\\' : '/';
  const normalized = path.replace(/[\\/]+$/, '');
  // At a drive root ("C:" or "C:\") → the drive list
  if (isWindows && /^[A-Za-z]:$/.test(normalized)) return DRIVES_ROOT;

  const parts = normalized.split(sep);
  parts.pop();
  if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) return sep;
  if (parts.length === 1 && /^[A-Za-z]:$/.test(parts[0])) return parts[0] + sep;
  return parts.join(sep);
}

/** True when there is nowhere further up to go ("/", or "This PC" on Windows). */
function isTopLevel(path: string, side: Side): boolean {
  return parentPath(path, side) === path;
}

/** Drag payload type: which pane the rows came from (types are readable during dragover). */
const dragType = (side: Side) => `application/x-nexus-sftp-${side}`;

// Column widths, shared by the header and the rows. Optional columns appear as the pane widens.
const COL = {
  icon: 'flex w-4 shrink-0 items-center justify-center',
  name: 'min-w-0 flex-1',
  size: 'w-18 shrink-0 justify-end text-right',
  modified: 'hidden w-24 shrink-0 justify-end text-right @sm:flex',
  perms: 'hidden w-20 shrink-0 justify-end text-right @md:flex',
} as const;

// ── Types ───────────────────────────────────────────────────

interface FilePaneProps {
  side: Side;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: SFTPEntry | null;
  /** Element to give focus back to before running an item's action. */
  opener: HTMLElement | null;
}

// ── Pieces ──────────────────────────────────────────────────

const SkeletonRow: React.FC = () => (
  <div aria-hidden="true" className="flex h-7 items-center gap-2 px-2">
    <div className="size-4 shrink-0 animate-pulse rounded-sm bg-surface-raised" />
    <div className="h-3 flex-1 animate-pulse rounded-sm bg-surface-raised" />
    <div className="h-3 w-14 shrink-0 animate-pulse rounded-sm bg-surface-raised" />
  </div>
);

interface SortHeaderProps {
  field: SortField;
  label: string;
  className: string;
  sortBy: SortField;
  sortDir: 'asc' | 'desc';
  onSort: (field: SortField) => void;
}

function SortHeader({
  field,
  label,
  className,
  sortBy,
  sortDir,
  onSort,
}: SortHeaderProps) {
  const active = sortBy === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      aria-label={`Sort by ${label}${active ? (sortDir === 'asc' ? ', ascending' : ', descending') : ''}`}
      className={cx(
        'flex h-full items-center gap-0.5 rounded-sm hover:text-fg-secondary focus-ring-inset',
        active && 'text-fg-secondary',
        className
      )}
    >
      <span className="truncate">{label}</span>
      {active && <Icon icon={sortDir === 'asc' ? ChevronUp : ChevronDown} size={12} />}
    </button>
  );
}

// ── Component ───────────────────────────────────────────────

export const FilePane: React.FC<FilePaneProps> = ({ side }) => {
  // Only the fields the pane uses: transfer progress (many updates a second) doesn't re-render
  // the file lists.
  const {
    localPath,
    remotePath,
    localFiles,
    remoteFiles,
    localLoading,
    remoteLoading,
    showHidden,
    sortBy,
    sortDir,
    selectedLocalFiles,
    selectedRemoteFiles,
    navigateLocal,
    navigateRemote,
    toggleHidden,
    setSortBy,
    toggleSortDir,
    setSelectedLocalFiles,
    setSelectedRemoteFiles,
    uploadFiles,
    downloadFiles,
    createRemoteDirectory,
    deleteRemoteFile,
    renameRemoteFile,
    refreshRemote,
    activeSessionId,
  } = useSFTPStore(
    useShallow((s) => ({
      localPath: s.localPath,
      remotePath: s.remotePath,
      localFiles: s.localFiles,
      remoteFiles: s.remoteFiles,
      localLoading: s.localLoading,
      remoteLoading: s.remoteLoading,
      showHidden: s.showHidden,
      sortBy: s.sortBy,
      sortDir: s.sortDir,
      selectedLocalFiles: s.selectedLocalFiles,
      selectedRemoteFiles: s.selectedRemoteFiles,
      navigateLocal: s.navigateLocal,
      navigateRemote: s.navigateRemote,
      toggleHidden: s.toggleHidden,
      setSortBy: s.setSortBy,
      toggleSortDir: s.toggleSortDir,
      setSelectedLocalFiles: s.setSelectedLocalFiles,
      setSelectedRemoteFiles: s.setSelectedRemoteFiles,
      uploadFiles: s.uploadFiles,
      downloadFiles: s.downloadFiles,
      createRemoteDirectory: s.createRemoteDirectory,
      deleteRemoteFile: s.deleteRemoteFile,
      renameRemoteFile: s.renameRemoteFile,
      refreshRemote: s.refreshRemote,
      activeSessionId: s.activeSessionId,
    }))
  );
  const addNotification = useUIStore((s) => s.addNotification);

  const isRemote = side === 'remote';
  const path = isRemote ? remotePath : localPath;
  const files = isRemote ? remoteFiles : localFiles;
  const loading = isRemote ? remoteLoading : localLoading;
  const selected = isRemote ? selectedRemoteFiles : selectedLocalFiles;
  const setSelected = isRemote ? setSelectedRemoteFiles : setSelectedLocalFiles;
  const navigate = isRemote ? navigateRemote : navigateLocal;
  const sideName = isRemote ? 'Remote' : 'Local';

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [chmodTarget, setChmodTarget] = useState<SFTPEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SFTPEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    entry: SFTPEntry;
    name: string;
  } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const anchorIndex = useRef(-1); // start of a Shift range
  const paneRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Set once an inline edit (rename / new folder) is committed or cancelled, so the blur that
  // follows doesn't run it again.
  const editSettled = useRef(false);

  const current = files.length === 0 ? -1 : Math.min(activeIndex, files.length - 1);

  // The folder whose listing (or error) is on screen. Until the current path has loaded the
  // pane shows the loading skeleton; a refresh of the same folder keeps the list (and the
  // focused row) instead of flashing the skeleton.
  const [shownPath, setShownPath] = useState<string | null>(null);
  const showSkeleton = shownPath !== path;

  // ── Loading folders ─────────────────────────────────────
  // The store keeps the old listing when a folder can't be read, so the pane shows the error
  // instead of the previous folder's files under the new path.

  const load = useCallback(
    async (newPath: string) => {
      setListError(null);
      await navigate(newPath);
      const state = useSFTPStore.getState();
      if ((side === 'remote' ? state.remotePath : state.localPath) !== newPath) return; // superseded
      setListError(state.error);
      setShownPath(newPath);
    },
    [navigate, side]
  );

  // First folder for each session: "/" on the server, the home folder locally.
  useEffect(() => {
    if (!activeSessionId) return;
    setShownPath(null);
    if (side === 'remote') {
      void load('/');
      return;
    }
    void (async () => {
      let start = useSFTPStore.getState().localPath;
      try {
        start = await window.nexus.fs.home();
      } catch {
        // keep the current local path
      }
      void load(start);
    })();
  }, [activeSessionId, side, load]);

  useEffect(() => {
    setActiveIndex(0);
    anchorIndex.current = -1;
  }, [path]);

  // ── Focus helpers ───────────────────────────────────────

  const focusRow = useCallback((index: number) => {
    setActiveIndex(index);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
  }, []);

  // Keyboard focus after the list changes under it (rename, delete, opening a folder): the
  // focused row may be gone, so focus a row by name (or whatever row is now at an index) once
  // the new list is on screen.
  const pendingFocus = useRef<{ name?: string; index?: number } | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusAfterRefresh = useCallback((target: { name?: string; index?: number }) => {
    pendingFocus.current = target;
    setFocusRequest((n) => n + 1);
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || showSkeleton) return; // wait for the listing
    pendingFocus.current = null;
    if (!listRef.current || files.length === 0) return; // empty or error state: nothing to focus
    const byName =
      target.name !== undefined ? files.findIndex((f) => f.filename === target.name) : -1;
    focusRow(
      Math.max(0, Math.min(byName >= 0 ? byName : (target.index ?? 0), files.length - 1))
    );
  }, [focusRequest, files, showSkeleton, focusRow]);

  // ── Actions ─────────────────────────────────────────────

  const fullPath = useCallback(
    (entry: SFTPEntry) => joinPath(path, entry.filename, side),
    [path, side]
  );

  const openEntry = useCallback(
    (entry: SFTPEntry) => {
      if (entry.isDirectory) {
        // Focus moves to the new folder's first row (the opened row is gone)
        void load(fullPath(entry)).then(() => focusAfterRefresh({ index: 0 }));
      } else if (side === 'remote') {
        // Opening a remote file downloads it into the local pane's folder
        void downloadFiles([fullPath(entry)], useSFTPStore.getState().localPath);
      }
    },
    [load, fullPath, side, downloadFiles, focusAfterRefresh]
  );

  const goParent = useCallback(
    () => void load(parentPath(path, side)),
    [load, path, side]
  );
  const refresh = useCallback(() => void load(path), [load, path]);

  const selectedFilePaths = useMemo(
    () =>
      files
        .filter((f) => !f.isDirectory && selected.includes(f.filename))
        .map((f) => joinPath(path, f.filename, side)),
    [files, selected, path, side]
  );

  const transferSelection = () => {
    if (selectedFilePaths.length === 0) return;
    if (side === 'local')
      void uploadFiles(selectedFilePaths, useSFTPStore.getState().remotePath);
    else void downloadFiles(selectedFilePaths, useSFTPStore.getState().localPath);
  };

  const startRename = (entry: SFTPEntry) => {
    editSettled.current = false;
    setRenameTarget({ entry, name: entry.filename });
  };

  const commitRename = async () => {
    if (editSettled.current || !renameTarget) return;
    editSettled.current = true;
    const { entry, name } = renameTarget;
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === entry.filename) {
      setRenameTarget(null);
      focusAfterRefresh({ name: entry.filename });
      return;
    }
    try {
      await renameRemoteFile(fullPath(entry), joinPath(path, trimmed, 'remote'));
      focusAfterRefresh({ name: trimmed });
    } catch (err) {
      addNotification(
        'error',
        `Couldn't rename ${entry.filename}: ${(err as Error).message}`
      );
      focusAfterRefresh({ name: entry.filename });
    }
    setRenameTarget(null);
  };

  const cancelRename = () => {
    if (!renameTarget) return;
    editSettled.current = true;
    const name = renameTarget.entry.filename;
    setRenameTarget(null);
    focusAfterRefresh({ name });
  };

  const startNewFolder = () => {
    editSettled.current = false;
    setNewFolderName('');
  };

  const commitNewFolder = async () => {
    if (editSettled.current || newFolderName === null) return;
    editSettled.current = true;
    const name = newFolderName.trim();
    if (name === '') {
      setNewFolderName(null);
      return;
    }
    try {
      await createRemoteDirectory(joinPath(path, name, 'remote'));
      focusAfterRefresh({ name });
    } catch (err) {
      // Used to be an unhandled rejection that left the field open (and retried on blur).
      addNotification(
        'error',
        `Couldn't create folder ${name}: ${(err as Error).message}`
      );
    }
    setNewFolderName(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const index = files.findIndex((f) => f.filename === deleteTarget.filename);
    setDeleting(true);
    try {
      await deleteRemoteFile(fullPath(deleteTarget), deleteTarget.isDirectory);
      setDeleteTarget(null);
      focusAfterRefresh({ index });
    } catch (err) {
      addNotification(
        'error',
        `Couldn't delete ${deleteTarget.filename}: ${(err as Error).message}`
      );
    } finally {
      setDeleting(false);
    }
  };

  const applyChmod = async (mode: string) => {
    if (!chmodTarget || !activeSessionId) return;
    try {
      await window.nexus.sftp.chmod(activeSessionId, fullPath(chmodTarget), mode);
    } catch (err) {
      addNotification(
        'error',
        `Couldn't change permissions of ${chmodTarget.filename}: ${(err as Error).message}`
      );
      throw err;
    }
    addNotification('success', `Permissions of ${chmodTarget.filename} set to ${mode}`);
    await refreshRemote();
  };

  const copyPath = async (entry: SFTPEntry) => {
    try {
      await navigator.clipboard.writeText(fullPath(entry));
      addNotification('success', 'Path copied to clipboard');
    } catch {
      addNotification('error', "Couldn't copy the path to the clipboard");
    }
  };

  const handleSortClick = (field: SortField) => {
    if (sortBy === field) toggleSortDir();
    else setSortBy(field);
  };

  // ── Selection ───────────────────────────────────────────

  const selectRange = (from: number, to: number) => {
    const [start, end] = from <= to ? [from, to] : [to, from];
    setSelected(files.slice(start, end + 1).map((f) => f.filename));
  };

  const handleRowClick = (entry: SFTPEntry, index: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected(
        selected.includes(entry.filename)
          ? selected.filter((f) => f !== entry.filename)
          : [...selected, entry.filename]
      );
      anchorIndex.current = index;
    } else if (e.shiftKey && anchorIndex.current >= 0) {
      selectRange(anchorIndex.current, index);
    } else {
      setSelected([entry.filename]);
      anchorIndex.current = index;
    }
  };

  // ── Context menu ────────────────────────────────────────

  const openMenuAt = (
    entry: SFTPEntry | null,
    anchor: HTMLElement,
    e?: React.MouseEvent
  ) => {
    const r = anchor.getBoundingClientRect();
    // Pointer position for a right-click; under the row's name for the keyboard (whose
    // contextmenu event may carry no pointer position).
    const atPointer =
      e &&
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom;
    setContextMenu({
      x: atPointer ? e.clientX : r.left + 24,
      y: atPointer ? e.clientY : entry ? r.bottom : r.top + 8,
      entry,
      opener: anchor,
    });
  };

  const handleRowContextMenu = (
    entry: SFTPEntry,
    index: number,
    e: React.MouseEvent<HTMLElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.includes(entry.filename)) {
      setSelected([entry.filename]);
      anchorIndex.current = index;
    }
    const row = e.currentTarget;
    setActiveIndex(index);
    row.focus();
    openMenuAt(entry, row, e);
  };

  const buildMenu = ({ entry, opener }: ContextMenuState): ContextMenuEntry[] => {
    // Focus goes back to the row before the action runs, so a dialog it opens returns focus there.
    const run = (fn: () => void) => () => {
      opener?.focus();
      fn();
    };
    const icon = (i: LucideIcon) => <Icon icon={i} size={14} />;
    const items: ContextMenuEntry[] = [];

    if (entry) {
      if (side === 'local' && !entry.isDirectory) {
        items.push({
          label: 'Upload',
          icon: icon(Upload),
          onClick: run(
            () => void uploadFiles([fullPath(entry)], useSFTPStore.getState().remotePath)
          ),
        });
      }
      if (side === 'remote' && !entry.isDirectory) {
        items.push({
          label: 'Download',
          icon: icon(Download),
          onClick: run(
            () => void downloadFiles([fullPath(entry)], useSFTPStore.getState().localPath)
          ),
        });
      }
      if (entry.isDirectory) {
        items.push({
          label: 'Open',
          icon: icon(FolderOpen),
          onClick: run(() => openEntry(entry)),
        });
      }
      items.push({ type: 'divider' });
      if (side === 'remote') {
        items.push({
          label: 'Rename',
          icon: icon(Pencil),
          onClick: run(() => startRename(entry)),
        });
        items.push({
          label: 'Delete…',
          icon: icon(Trash2),
          danger: true,
          onClick: run(() => setDeleteTarget(entry)),
        });
        items.push({ type: 'divider' });
        items.push({
          label: 'Permissions…',
          icon: icon(LockKeyhole),
          onClick: run(() => setChmodTarget(entry)),
        });
      }
      items.push({
        label: 'Copy path',
        icon: icon(Copy),
        onClick: run(() => void copyPath(entry)),
      });
    } else {
      if (side === 'remote') {
        items.push({
          label: 'New folder',
          icon: icon(FolderPlus),
          onClick: run(startNewFolder),
        });
      }
      items.push({ label: 'Refresh', icon: icon(RefreshCw), onClick: run(refresh) });
      items.push({
        label: showHidden ? 'Hide hidden files' : 'Show hidden files',
        icon: icon(showHidden ? EyeOff : Eye),
        onClick: run(toggleHidden),
      });
    }
    return items;
  };

  // ── Keyboard (list) ─────────────────────────────────────

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input')) return; // typing in the rename field
    const n = files.length;
    const entry = current >= 0 ? files[current] : null;
    const ctrl = e.ctrlKey || e.metaKey;

    const moveTo = (next: number) => {
      e.preventDefault();
      if (n === 0) return;
      const i = Math.max(0, Math.min(n - 1, next));
      focusRow(i);
      if (e.shiftKey) {
        if (anchorIndex.current < 0) anchorIndex.current = Math.max(current, 0);
        selectRange(anchorIndex.current, i);
      } else if (!ctrl) {
        setSelected([files[i].filename]);
        anchorIndex.current = i;
      }
    };

    switch (e.key) {
      case 'ArrowDown':
        return moveTo(current + 1);
      case 'ArrowUp':
        return moveTo(current - 1);
      case 'Home':
        return moveTo(0);
      case 'End':
        return moveTo(n - 1);
      case 'Enter':
        if (entry) {
          e.preventDefault();
          openEntry(entry);
        }
        return;
      case ' ':
        if (!entry) return;
        e.preventDefault();
        if (ctrl) {
          setSelected(
            selected.includes(entry.filename)
              ? selected.filter((f) => f !== entry.filename)
              : [...selected, entry.filename]
          );
          anchorIndex.current = current;
        } else if (e.shiftKey && anchorIndex.current >= 0) {
          selectRange(anchorIndex.current, current);
        } else {
          setSelected([entry.filename]);
          anchorIndex.current = current;
        }
        return;
      case 'a':
      case 'A':
        if (ctrl) {
          e.preventDefault();
          setSelected(files.map((f) => f.filename));
        }
        return;
      case 'Backspace': {
        e.preventDefault();
        // Up a level, with focus on the folder we came from
        const from = path
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop();
        void load(parentPath(path, side)).then(() => focusAfterRefresh({ name: from }));
        return;
      }
      case 'F2':
        if (entry && isRemote) {
          e.preventDefault();
          startRename(entry);
        }
        return;
      case 'Delete':
        if (entry && isRemote) {
          e.preventDefault();
          setDeleteTarget(entry);
        }
        return;
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return;
        e.preventDefault();
        if (entry) {
          const row = listRef.current?.querySelector<HTMLElement>(
            `[data-index="${current}"]`
          );
          if (row) {
            if (!selected.includes(entry.filename)) setSelected([entry.filename]);
            openMenuAt(entry, row);
          }
        } else if (listRef.current) {
          openMenuAt(null, listRef.current);
        }
        return;
    }
  };

  // ── Drag & drop ─────────────────────────────────────────
  // Rows drag to the other pane (local → remote uploads, remote → local downloads); the remote
  // pane also takes files from the OS. Folders aren't transferred, so they don't drag.

  const otherSide: Side = isRemote ? 'local' : 'remote';
  const accepts = (dt: DataTransfer) =>
    dt.types.includes(dragType(otherSide)) || (isRemote && dt.types.includes('Files'));

  const handleDragStart = (e: React.DragEvent, entry: SFTPEntry) => {
    const rows = selected.includes(entry.filename)
      ? files.filter((f) => selected.includes(f.filename))
      : [entry];
    const paths = rows
      .filter((f) => !f.isDirectory)
      .map((f) => joinPath(path, f.filename, side));
    if (paths.length === 0) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.setData(dragType(side), JSON.stringify(paths));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!accepts(e.dataTransfer)) return; // not a drop target for this (no overlay, no drop)
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only when leaving the pane itself, not when moving between its children
    if (paneRef.current && !paneRef.current.contains(e.relatedTarget as Node))
      setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    setDragOver(false);
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();

    if (isRemote && e.dataTransfer.files.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const filePath = window.nexus.fs.getPathForFile(e.dataTransfer.files[i]);
        if (filePath) paths.push(filePath);
      }
      if (paths.length > 0) void uploadFiles(paths, path);
      return;
    }

    let paths: string[] = [];
    try {
      paths = JSON.parse(e.dataTransfer.getData(dragType(otherSide)) || '[]') as string[];
    } catch {
      return;
    }
    if (paths.length === 0) return;
    if (isRemote) void uploadFiles(paths, path);
    else void downloadFiles(paths, path);
  };

  // ── Render ──────────────────────────────────────────────

  const showEmpty =
    !showSkeleton && !listError && files.length === 0 && newFolderName === null;
  const transferLabel = isRemote ? 'Download selected files' : 'Upload selected files';

  return (
    <section
      ref={paneRef}
      aria-label={`${sideName} files`}
      className="@container relative flex h-full min-w-0 flex-col bg-surface select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar: wraps the actions onto a second row when the pane is narrow */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-surface-sunken px-2 py-1.5">
        <span
          className="flex size-6 shrink-0 items-center justify-center text-fg-muted"
          title={sideName}
        >
          <Icon icon={isRemote ? Server : Laptop} size={14} />
        </span>
        <IconButton
          size="sm"
          icon={ArrowUp}
          label="Go to parent folder"
          onClick={goParent}
          disabled={isTopLevel(path, side)}
        />
        <BreadcrumbPath path={path} side={side} onNavigate={(p) => void load(p)} />
        <Toolbar label={`${sideName} folder actions`} className="ml-auto shrink-0">
          <IconButton
            size="sm"
            icon={isRemote ? Download : Upload}
            label={transferLabel}
            onClick={transferSelection}
            disabled={selectedFilePaths.length === 0}
          />
          {isRemote && (
            <IconButton
              size="sm"
              icon={FolderPlus}
              label="New folder"
              onClick={startNewFolder}
            />
          )}
          <IconButton
            size="sm"
            icon={showHidden ? Eye : EyeOff}
            label="Show hidden files"
            pressed={showHidden}
            onClick={toggleHidden}
          />
          <IconButton size="sm" icon={RefreshCw} label="Refresh" onClick={refresh} />
        </Toolbar>
      </div>

      {/* Column headers (click to sort) */}
      <div className="flex h-6 shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-2 text-caption font-medium text-fg-muted">
        <span className={COL.icon} aria-hidden="true" />
        <SortHeader
          field="filename"
          label="Name"
          className={COL.name}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSortClick}
        />
        <SortHeader
          field="size"
          label="Size"
          className={COL.size}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSortClick}
        />
        <SortHeader
          field="modifyTime"
          label="Modified"
          className={COL.modified}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSortClick}
        />
        {isRemote && (
          <SortHeader
            field="permissions"
            label="Permissions"
            className={COL.perms}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSortClick}
          />
        )}
      </div>

      {/* File list. Right-clicking the empty area opens the folder menu. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin"
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuAt(null, e.currentTarget, e);
        }}
      >
        {showSkeleton ? (
          <>
            <p role="status" className="sr-only">
              Loading files…
            </p>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </>
        ) : listError ? (
          <EmptyState
            icon={FolderX}
            title="Couldn't open this folder"
            description={<span className="break-all font-code">{listError}</span>}
            action={<Button onClick={refresh}>Try Again</Button>}
            className="h-full"
          />
        ) : showEmpty ? (
          <EmptyState
            icon={FolderOpen}
            title="This folder is empty"
            description={isRemote ? 'Drag files here to upload them.' : undefined}
            action={
              isRemote ? (
                <Button icon={FolderPlus} onClick={startNewFolder}>
                  New Folder
                </Button>
              ) : undefined
            }
            className="h-full"
          />
        ) : (
          <div
            ref={listRef}
            role="listbox"
            aria-label={`${sideName} files`}
            aria-multiselectable="true"
            aria-busy={loading || undefined}
            tabIndex={files.length === 0 ? 0 : -1}
            onKeyDown={handleListKeyDown}
            className="flex flex-col py-0.5 outline-none"
          >
            {files.map((entry, index) => {
              const isSelected = selected.includes(entry.filename);
              const isRenaming = renameTarget?.entry.filename === entry.filename;
              const fileIcon = getFileIcon(entry);
              return (
                <div
                  key={entry.filename}
                  data-index={index}
                  // While renaming, the row steps out of the listbox semantics (an option's
                  // content is presentational) so the name field is exposed as a textbox.
                  role={isRenaming ? undefined : 'option'}
                  aria-selected={isRenaming ? undefined : isSelected}
                  aria-label={isRenaming ? undefined : entry.filename}
                  tabIndex={index === current ? 0 : -1}
                  onFocus={(e) => {
                    if (e.target === e.currentTarget) setActiveIndex(index);
                  }}
                  onClick={(e) => handleRowClick(entry, index, e)}
                  onDoubleClick={() => openEntry(entry)}
                  onContextMenu={(e) => handleRowContextMenu(entry, index, e)}
                  draggable={!entry.isDirectory && !isRenaming}
                  onDragStart={(e) => handleDragStart(e, entry)}
                  className={cx(
                    'flex h-7 shrink-0 cursor-default items-center gap-2 px-2 text-body-sm text-fg focus-ring-inset',
                    'transition-colors duration-(--duration-fast) ease-standard',
                    isSelected ? 'bg-accent-soft' : 'hover:bg-surface-hover'
                  )}
                >
                  <span className={cx(COL.icon, fileIcon.className)}>
                    <Icon icon={fileIcon.icon} size={15} />
                  </span>

                  <span className={cx(COL.name, 'flex items-center')}>
                    {isRenaming ? (
                      <span className="min-w-0 flex-1">
                        <Input
                          size="sm"
                          code
                          aria-label={`New name for ${entry.filename}`}
                          value={renameTarget.name}
                          onChange={(e) =>
                            setRenameTarget({ ...renameTarget, name: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitRename();
                            } else if (e.key === 'Escape') {
                              e.stopPropagation();
                              cancelRename();
                            }
                          }}
                          onBlur={() => void commitRename()}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          autoFocus
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </span>
                    ) : (
                      <span className="truncate font-code" title={entry.filename}>
                        {entry.filename}
                      </span>
                    )}
                  </span>

                  <span className={cx(COL.size, 'tabular-nums text-fg-muted')}>
                    {entry.isDirectory ? '--' : formatFileSize(entry.size)}
                  </span>
                  <span
                    className={cx(COL.modified, 'tabular-nums text-fg-muted')}
                    title={
                      entry.modifyTime
                        ? new Date(entry.modifyTime * 1000).toLocaleString()
                        : undefined
                    }
                  >
                    {formatDate(entry.modifyTime)}
                  </span>
                  {isRemote && (
                    <span className={cx(COL.perms, 'font-code text-fg-muted')}>
                      {modeToString(entry.permissions)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Inline new-folder row */}
        {newFolderName !== null && !showSkeleton && (
          <div className="flex h-8 items-center gap-2 px-2 text-body-sm">
            <span className={cx(COL.icon, 'text-warning')}>
              <Icon icon={Folder} size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <Input
                size="sm"
                code
                aria-label="New folder name"
                placeholder="New folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitNewFolder();
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    editSettled.current = true;
                    setNewFolderName(null);
                  }
                }}
                onBlur={() => void commitNewFolder()}
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
        )}
      </div>

      <DragDropOverlay side={side} visible={dragOver} />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenu(contextMenu)}
          label={
            contextMenu.entry
              ? `Actions for ${contextMenu.entry.filename}`
              : `${sideName} folder actions`
          }
          onClose={() => setContextMenu(null)}
        />
      )}

      {chmodTarget && (
        <ChmodDialog
          open
          onClose={() => setChmodTarget(null)}
          filename={chmodTarget.filename}
          currentMode={chmodTarget.permissions}
          onApply={applyChmod}
        />
      )}

      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        size="sm"
        title={deleteTarget ? `Delete ${deleteTarget.filename}?` : 'Delete?'}
        description={
          deleteTarget?.isDirectory
            ? 'This permanently deletes the folder and everything in it from the server.'
            : 'This permanently deletes the file from the server.'
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleteTarget?.isDirectory ? 'Delete Folder' : 'Delete File'}
            </Button>
          </>
        }
      />
    </section>
  );
};
