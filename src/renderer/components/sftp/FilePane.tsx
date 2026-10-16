import React, { useState, useCallback, useMemo, useRef } from 'react';
import type { SFTPEntry } from '../../../shared/types';
import { useSFTPStore, type SortField } from '../../stores/sftp-store';
import { BreadcrumbPath } from './BreadcrumbPath';
import { DragDropOverlay } from './DragDropOverlay';
import { ContextMenu, type ContextMenuEntry } from '../vault/ContextMenu';
import { ChmodDialog } from './ChmodDialog';
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
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
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { Icon } from '../common/Icon';

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

/** Map file extensions to an icon (and colour) so file types are easy to tell apart. */
function getFileIcon(entry: SFTPEntry): { icon: LucideIcon; color: string } {
  if (entry.isDirectory) return { icon: Folder, color: 'var(--color-warning)' };
  if (entry.isSymlink) return { icon: FileSymlink, color: 'var(--color-accent)' };

  const ext = entry.filename.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'cs', 'sh', 'bash', 'zsh', 'ps1'];
  const configExts = ['json', 'yaml', 'yml', 'toml', 'ini', 'xml', 'env', 'conf', 'cfg'];
  const textExts = ['log', 'txt', 'md', 'rst', 'csv'];
  const archiveExts = ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z', 'tgz'];
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];

  const muted = 'var(--color-text-muted)';
  if (codeExts.includes(ext)) return { icon: FileCode, color: muted };
  if (configExts.includes(ext)) return { icon: FileCog, color: muted };
  if (textExts.includes(ext)) return { icon: FileText, color: muted };
  if (archiveExts.includes(ext)) return { icon: FileArchive, color: muted };
  if (imageExts.includes(ext)) return { icon: FileImage, color: muted };
  return { icon: File, color: muted };
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
    <Icon icon={direction === 'asc' ? ChevronUp : ChevronDown} size={12} className="inline-block ml-0.5" />
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
          <Icon icon={ChevronLeft} size={14} />
        </button>

        {/* Breadcrumb */}
        <BreadcrumbPath path={path} side={side} onNavigate={handleNavigate} />

        {/* Hidden files toggle */}
        <button
          className={`btn-ghost w-6 h-6 flex items-center justify-center rounded text-[10px] ${showHidden ? 'text-[var(--color-accent)]' : ''}`}
          onClick={toggleHidden}
          title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
        >
          <Icon icon={showHidden ? Eye : EyeOff} size={14} />
        </button>

        {/* Refresh */}
        <button
          className="btn-ghost w-6 h-6 flex items-center justify-center rounded"
          onClick={() => refresh()}
          title="Refresh"
        >
          <Icon icon={RefreshCw} size={14} />
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
            <Icon icon={FolderOpen} size={40} strokeWidth={1.25} color="var(--color-text-muted)" />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              This folder is empty
            </span>
          </div>
        ) : (
          files.map((entry, index) => {
            const isSelected = selected.includes(entry.filename);
            const isRenaming = renameTarget?.entry.filename === entry.filename;
            const fileIcon = getFileIcon(entry);

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
                <span className="flex w-7 flex-shrink-0 items-center justify-center">
                  <Icon icon={fileIcon.icon} size={15} color={fileIcon.color} />
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
            <span className="flex w-7 flex-shrink-0 items-center justify-center">
              <Icon icon={Folder} size={15} color="var(--color-warning)" />
            </span>
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
