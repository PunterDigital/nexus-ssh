import React, { useState, useCallback, useMemo, useRef } from 'react';
import type { SFTPEntry } from '../../../shared/types';
import { useSFTPStore, type SortField } from '../../stores/sftp-store';
import { BreadcrumbPath } from './BreadcrumbPath';
import { DragDropOverlay } from './DragDropOverlay';
import { ContextMenu, type ContextMenuEntry } from '../vault/ContextMenu';
import { ChmodDialog } from './ChmodDialog';

// ============================================================
// FilePane — reusable file browser pane (local or remote)
// ============================================================

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
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
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

function permissionsToString(mode: number): string {
  const perms = mode & 0o777;
  const chars = 'rwxrwxrwx';
  let result = '';
  for (let i = 8; i >= 0; i--) {
    result += (perms & (1 << i)) ? chars[8 - i] : '-';
  }
  return result;
}

/** Map file extensions to icon labels for visual distinction */
function getFileIcon(entry: SFTPEntry): string {
  if (entry.isDirectory) return '\uD83D\uDCC1'; // folder
  if (entry.isSymlink) return '\uD83D\uDD17'; // link

  const ext = entry.filename.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'cs', 'sh', 'bash', 'zsh', 'ps1'];
  const configExts = ['json', 'yaml', 'yml', 'toml', 'ini', 'xml', 'env', 'conf', 'cfg'];
  const textExts = ['log', 'txt', 'md', 'rst', 'csv'];
  const archiveExts = ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z', 'tgz'];
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];

  if (codeExts.includes(ext)) return '\uD83D\uDCDD'; // code memo
  if (configExts.includes(ext)) return '\u2699\uFE0F'; // gear
  if (textExts.includes(ext)) return '\uD83D\uDCC4'; // page
  if (archiveExts.includes(ext)) return '\uD83D\uDCE6'; // package
  if (imageExts.includes(ext)) return '\uD83D\uDDBC\uFE0F'; // picture
  return '\uD83D\uDCC4'; // generic file
}

function joinPath(base: string, name: string, side: 'local' | 'remote'): string {
  if (side === 'remote') {
    return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
  }
  // At the drives root, clicking a drive like "C:" should go to "C:\"
  if (base === '__drives__') {
    return name.endsWith(':') ? `${name}\\` : name;
  }
  // Local paths — use OS-appropriate separator
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

/** Sentinel path for Windows drive list ("This PC"). */
export const DRIVES_ROOT = '__drives__';

function parentPath(path: string, side: 'local' | 'remote'): string {
  if (side === 'remote') {
    const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
    parts.pop();
    return parts.length === 0 ? '/' : '/' + parts.join('/');
  }
  // Already at the drives root — nowhere to go
  if (path === DRIVES_ROOT) return DRIVES_ROOT;

  // Local (Windows or Unix)
  const isWindows = /\\|^[A-Za-z]:/.test(path);
  const sep = isWindows ? '\\' : '/';
  const normalized = path.replace(/[\\/]+$/, '');

  // At a Windows drive root like "C:" or "C:\"  → go to the drives list
  if (isWindows && /^[A-Za-z]:$/.test(normalized)) {
    return DRIVES_ROOT;
  }

  const parts = normalized.split(sep);
  parts.pop();
  if (parts.length === 0) return sep;
  // Single drive letter left → keep drive root on Windows
  if (parts.length === 1 && /^[A-Za-z]:$/.test(parts[0])) return parts[0] + sep;
  return parts.join(sep);
}

// ── Types ───────────────────────────────────────────────────

interface FilePaneProps {
  side: 'local' | 'remote';
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: SFTPEntry | null;
}

// ── Skeleton row for loading state ──────────────────────────

const SkeletonRow: React.FC = () => (
  <div className="flex items-center gap-3 px-3 py-1.5 animate-pulse">
    <div className="w-5 h-4 rounded" style={{ backgroundColor: 'var(--color-bg-tertiary)' }} />
    <div className="flex-1 h-3 rounded" style={{ backgroundColor: 'var(--color-bg-tertiary)' }} />
    <div className="w-14 h-3 rounded" style={{ backgroundColor: 'var(--color-bg-tertiary)' }} />
    <div className="w-20 h-3 rounded" style={{ backgroundColor: 'var(--color-bg-tertiary)' }} />
  </div>
);

// ── Sort indicator SVG ──────────────────────────────────────

const SortArrow: React.FC<{ active: boolean; direction: 'asc' | 'desc' }> = ({ active, direction }) => {
  if (!active) return null;
  return (
    <svg
      className="w-3 h-3 inline-block ml-0.5"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      {direction === 'asc' ? (
        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
      ) : (
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
      )}
    </svg>
  );
};

// ── Component ───────────────────────────────────────────────

export const FilePane: React.FC<FilePaneProps> = ({ side }) => {
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
    refreshLocal,
    refreshRemote,
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
    activeSessionId,
  } = useSFTPStore();

  const path = side === 'local' ? localPath : remotePath;
  const files = side === 'local' ? localFiles : remoteFiles;
  const loading = side === 'local' ? localLoading : remoteLoading;
  const selected = side === 'local' ? selectedLocalFiles : selectedRemoteFiles;
  const setSelected = side === 'local' ? setSelectedLocalFiles : setSelectedRemoteFiles;
  const navigate = side === 'local' ? navigateLocal : navigateRemote;
  const refresh = side === 'local' ? refreshLocal : refreshRemote;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [chmodTarget, setChmodTarget] = useState<SFTPEntry | null>(null);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ entry: SFTPEntry; name: string } | null>(null);

  const lastClickedIndex = useRef<number>(-1);
  const paneRef = useRef<HTMLDivElement>(null);

  // ── Navigation handlers ─────────────────────────────────

  const handleNavigate = useCallback(
    (newPath: string) => {
      navigate(newPath);
    },
    [navigate],
  );

  const handleGoParent = useCallback(() => {
    handleNavigate(parentPath(path, side));
  }, [handleNavigate, path, side]);

  const handleDoubleClick = useCallback(
    (entry: SFTPEntry) => {
      if (entry.isDirectory) {
        handleNavigate(joinPath(path, entry.filename, side));
      } else if (side === 'remote') {
        // Double-click file on remote = download
        const remoteFull = joinPath(path, entry.filename, 'remote');
        downloadFiles([remoteFull], useSFTPStore.getState().localPath);
      }
    },
    [handleNavigate, path, side, downloadFiles],
  );

  // ── Selection handlers ──────────────────────────────────

  const handleClick = useCallback(
    (entry: SFTPEntry, index: number, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (selected.includes(entry.filename)) {
          setSelected(selected.filter((f) => f !== entry.filename));
        } else {
          setSelected([...selected, entry.filename]);
        }
      } else if (e.shiftKey && lastClickedIndex.current >= 0) {
        // Range selection
        const start = Math.min(lastClickedIndex.current, index);
        const end = Math.max(lastClickedIndex.current, index);
        const rangeNames = files.slice(start, end + 1).map((f) => f.filename);
        setSelected(rangeNames);
      } else {
        setSelected([entry.filename]);
      }
      lastClickedIndex.current = index;
    },
    [selected, setSelected, files],
  );

  // ── Sorting ─────────────────────────────────────────────

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortBy === field) {
        toggleSortDir();
      } else {
        setSortBy(field);
      }
    },
    [sortBy, setSortBy, toggleSortDir],
  );

  // ── Context menu ────────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: SFTPEntry | null) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, entry });
    },
    [],
  );

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    const entry = contextMenu?.entry;
    const items: ContextMenuEntry[] = [];

    if (entry) {
      if (side === 'local' && !entry.isDirectory) {
        items.push({
          label: 'Upload',
          onClick: () => {
            const fullPath = joinPath(path, entry.filename, 'local');
            uploadFiles([fullPath], useSFTPStore.getState().remotePath);
          },
        });
      }
      if (side === 'remote' && !entry.isDirectory) {
        items.push({
          label: 'Download',
          onClick: () => {
            const fullPath = joinPath(path, entry.filename, 'remote');
            downloadFiles([fullPath], useSFTPStore.getState().localPath);
          },
        });
      }

      if (entry.isDirectory) {
        items.push({
          label: 'Open',
          onClick: () => handleNavigate(joinPath(path, entry.filename, side)),
        });
      }

      items.push({ type: 'divider' });

      if (side === 'remote') {
        items.push({
          label: 'Rename',
          onClick: () => setRenameTarget({ entry, name: entry.filename }),
        });
        items.push({
          label: 'Delete',
          danger: true,
          onClick: () => {
            const fullPath = joinPath(path, entry.filename, 'remote');
            deleteRemoteFile(fullPath);
          },
        });
        items.push({ type: 'divider' });
        items.push({
          label: 'Properties (chmod)',
          onClick: () => setChmodTarget(entry),
        });
      }

      items.push({
        label: 'Copy Path',
        onClick: () => {
          const fullPath = joinPath(path, entry.filename, side);
          navigator.clipboard.writeText(fullPath);
        },
      });
    } else {
      // Background context menu (no file clicked)
      if (side === 'remote') {
        items.push({
          label: 'New Folder',
          onClick: () => setNewFolderName(''),
        });
      }
      items.push({
        label: 'Refresh',
        onClick: () => refresh(),
      });
      items.push({
        label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files',
        onClick: toggleHidden,
      });
    }

    return items;
  }, [contextMenu, side, path, showHidden, handleNavigate, uploadFiles, downloadFiles, deleteRemoteFile, refresh, toggleHidden]);

  // ── Drag & Drop ─────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent, entry: SFTPEntry) => {
      const fullPath = joinPath(path, entry.filename, side);
      e.dataTransfer.setData('text/plain', fullPath);
      e.dataTransfer.setData('application/x-sftp-side', side);
      e.dataTransfer.setData('application/x-sftp-filename', entry.filename);
      e.dataTransfer.effectAllowed = 'copy';
    },
    [path, side],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we left the pane entirely
    if (paneRef.current && !paneRef.current.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      // Handle OS file drop
      if (e.dataTransfer.files.length > 0 && side === 'remote') {
        const paths: string[] = [];
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const filePath = window.nexus.fs.getPathForFile(e.dataTransfer.files[i]);
          if (filePath) paths.push(filePath);
        }
        if (paths.length > 0) {
          uploadFiles(paths, path);
        }
        return;
      }

      // Handle cross-pane drop
      const sourceSide = e.dataTransfer.getData('application/x-sftp-side');
      const sourcePath = e.dataTransfer.getData('text/plain');
      if (!sourcePath || sourceSide === side) return;

      if (side === 'remote' && sourceSide === 'local') {
        uploadFiles([sourcePath], path);
      } else if (side === 'local' && sourceSide === 'remote') {
        downloadFiles([sourcePath], path);
      }
    },
    [side, path, uploadFiles, downloadFiles],
  );

  // ── New folder handler ──────────────────────────────────

  const handleNewFolder = useCallback(async () => {
    if (newFolderName === null || newFolderName.trim() === '') {
      setNewFolderName(null);
      return;
    }
    const fullPath = joinPath(path, newFolderName.trim(), 'remote');
    await createRemoteDirectory(fullPath);
    setNewFolderName(null);
  }, [newFolderName, path, createRemoteDirectory]);

  // ── Rename handler ──────────────────────────────────────

  const handleRename = useCallback(async () => {
    if (!renameTarget || renameTarget.name.trim() === '' || renameTarget.name === renameTarget.entry.filename) {
      setRenameTarget(null);
      return;
    }
    const oldPath = joinPath(path, renameTarget.entry.filename, 'remote');
    const newPath = joinPath(path, renameTarget.name.trim(), 'remote');
    await renameRemoteFile(oldPath, newPath);
    setRenameTarget(null);
  }, [renameTarget, path, renameRemoteFile]);

  // ── Chmod handler ───────────────────────────────────────

  const handleChmod = useCallback(
    async (mode: string) => {
      if (!chmodTarget || !activeSessionId) return;
      const fullPath = joinPath(path, chmodTarget.filename, 'remote');
      await window.nexus.sftp.chmod(activeSessionId, fullPath, mode);
      await refreshRemote();
    },
    [chmodTarget, activeSessionId, path, refreshRemote],
  );

  // ── Column headers ──────────────────────────────────────

  const columns: { label: string; field: SortField | null; className: string }[] = useMemo(
    () => [
      { label: '', field: null, className: 'w-7 flex-shrink-0' },
      { label: 'Name', field: 'filename', className: 'flex-1 min-w-0' },
      { label: 'Size', field: 'size', className: 'w-20 text-right' },
      { label: 'Modified', field: 'modifyTime', className: 'w-24 text-right' },
      ...(side === 'remote'
        ? [{ label: 'Perms', field: 'permissions' as SortField, className: 'w-20 text-right' }]
        : []),
    ],
    [side],
  );

  return (
    <div
      ref={paneRef}
      className="flex flex-col h-full relative select-none"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(e) => handleContextMenu(e, null)}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-2 py-1 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {/* Back to parent */}
        <button
          className="btn-ghost w-6 h-6 flex items-center justify-center rounded"
          onClick={handleGoParent}
          title="Go to parent directory"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Breadcrumb */}
        <BreadcrumbPath path={path} side={side} onNavigate={handleNavigate} />

        {/* Hidden files toggle */}
        <button
          className={`btn-ghost w-6 h-6 flex items-center justify-center rounded text-[10px] ${showHidden ? 'text-[var(--color-accent)]' : ''}`}
          onClick={toggleHidden}
          title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {showHidden ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            )}
          </svg>
        </button>

        {/* Refresh */}
        <button
          className="btn-ghost w-6 h-6 flex items-center justify-center rounded"
          onClick={() => refresh()}
          title="Refresh"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Column headers */}
      <div
        className="flex items-center gap-0 px-3 py-1 text-[10px] font-medium border-b"
        style={{
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-muted)',
          backgroundColor: 'var(--color-bg-secondary)',
        }}
      >
        {columns.map((col, i) => (
          <div
            key={i}
            className={`${col.className} ${col.field ? 'cursor-pointer hover:text-[var(--color-text-secondary)] select-none' : ''}`}
            onClick={() => col.field && handleSort(col.field)}
          >
            {col.label}
            {col.field && <SortArrow active={sortBy === col.field} direction={sortDir} />}
          </div>
        ))}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          // Skeleton loading
          Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
        ) : files.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <svg
              className="w-10 h-10"
              style={{ color: 'var(--color-text-muted)' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              This folder is empty
            </span>
          </div>
        ) : (
          files.map((entry, index) => {
            const isSelected = selected.includes(entry.filename);
            const isRenaming = renameTarget?.entry.filename === entry.filename;

            return (
              <div
                key={entry.filename}
                className="flex items-center gap-0 px-3 py-1 text-xs cursor-pointer transition-colors"
                style={{
                  backgroundColor: isSelected
                    ? 'var(--color-accent-muted)'
                    : 'transparent',
                  color: isSelected
                    ? 'var(--color-accent)'
                    : 'var(--color-text-primary)',
                }}
                onClick={(e) => handleClick(entry, index, e)}
                onDoubleClick={() => handleDoubleClick(entry)}
                onContextMenu={(e) => handleContextMenu(e, entry)}
                draggable
                onDragStart={(e) => handleDragStart(e, entry)}
              >
                {/* Icon */}
                <span className="w-7 flex-shrink-0 text-center text-sm">
                  {getFileIcon(entry)}
                </span>

                {/* Name */}
                <div className="flex-1 min-w-0 truncate">
                  {isRenaming ? (
                    <input
                      className="input h-5 text-xs py-0 px-1"
                      value={renameTarget.name}
                      onChange={(e) =>
                        setRenameTarget({ ...renameTarget, name: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') setRenameTarget(null);
                      }}
                      onBlur={handleRename}
                      autoFocus
                      spellCheck={false}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate block" title={entry.filename}>
                      {entry.filename}
                    </span>
                  )}
                </div>

                {/* Size */}
                <span
                  className="w-20 text-right flex-shrink-0"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {entry.isDirectory ? '--' : formatFileSize(entry.size)}
                </span>

                {/* Modified */}
                <span
                  className="w-24 text-right flex-shrink-0"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={
                    entry.modifyTime
                      ? new Date(entry.modifyTime * 1000).toLocaleString()
                      : undefined
                  }
                >
                  {formatDate(entry.modifyTime)}
                </span>

                {/* Permissions (remote only) */}
                {side === 'remote' && (
                  <span
                    className="w-20 text-right flex-shrink-0 font-mono"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {permissionsToString(entry.permissions)}
                  </span>
                )}
              </div>
            );
          })
        )}

        {/* Inline new folder row */}
        {newFolderName !== null && (
          <div className="flex items-center gap-0 px-3 py-1 text-xs">
            <span className="w-7 flex-shrink-0 text-center text-sm">{'\uD83D\uDCC1'}</span>
            <div className="flex-1 min-w-0">
              <input
                className="input h-5 text-xs py-0 px-1"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewFolder();
                  if (e.key === 'Escape') setNewFolderName(null);
                }}
                onBlur={handleNewFolder}
                autoFocus
                placeholder="New folder name..."
                spellCheck={false}
              />
            </div>
          </div>
        )}
      </div>

      {/* Drag overlay */}
      <DragDropOverlay side={side} visible={dragOver} />

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Chmod dialog */}
      {chmodTarget && (
        <ChmodDialog
          open={!!chmodTarget}
          onClose={() => setChmodTarget(null)}
          filename={chmodTarget.filename}
          currentMode={chmodTarget.permissions}
          onApply={handleChmod}
        />
      )}
    </div>
  );
};
