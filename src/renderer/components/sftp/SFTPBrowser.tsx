import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSFTPStore } from '../../stores/sftp-store';
import { useSFTPTransferProgress } from '../../hooks/use-ipc';
import { cx } from '../ui';
import { FilePane } from './FilePane';
import { TransferPanel } from './TransferPanel';

// ============================================================
// SFTPBrowser — dual-pane file browser for one SFTP session: local files on the left, remote
// on the right, a draggable (and keyboard-resizable) divider between them, and the transfer
// queue underneath. Each pane loads its starting folder itself once the session is active.
// ============================================================

interface SFTPBrowserProps {
  sessionId: string;
}

/** Split limits, in percent of the browser's width. The panes also have a CSS minimum width. */
const SPLIT_MIN = 15;
const SPLIT_MAX = 85;
const SPLIT_DEFAULT = 50;

const clampSplit = (pct: number) => Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct));

export const SFTPBrowser: React.FC<SFTPBrowserProps> = ({ sessionId }) => {
  const setActiveSessionId = useSFTPStore((s) => s.setActiveSessionId);
  const updateTransferProgress = useSFTPStore((s) => s.updateTransferProgress);
  const completeTransfer = useSFTPStore((s) => s.completeTransfer);
  const failTransfer = useSFTPStore((s) => s.failTransfer);

  const [split, setSplit] = useState(SPLIT_DEFAULT); // left pane width, percent
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The panes (FilePane) load their first folder when the active session changes.
  useEffect(() => {
    setActiveSessionId(sessionId);
    return () => setActiveSessionId(null);
  }, [sessionId, setActiveSessionId]);

  // Transfer progress from the main process
  useSFTPTransferProgress(
    useCallback(
      (progress: unknown) => {
        const p = progress as {
          id: string;
          transferred: number;
          size?: number;
          status?: string;
          error?: string;
        };
        if (!p?.id) return;
        if (p.status === 'completed') {
          completeTransfer(p.id);
        } else if (p.status === 'failed') {
          failTransfer(p.id, p.error ?? 'Transfer failed');
        } else if (typeof p.transferred === 'number') {
          const status =
            p.status === 'paused' || p.status === 'queued' ? p.status : 'active';
          updateTransferProgress(p.id, p.transferred, p.size, status);
        }
      },
      [updateTransferProgress, completeTransfer, failTransfer]
    )
  );

  // The split is dynamic, so it goes in a CSS variable (basis-(--sftp-split)), not a style prop.
  useLayoutEffect(() => {
    containerRef.current?.style.setProperty('--sftp-split', `${split}%`);
  }, [split]);

  // ── Divider: pointer drag, arrow keys, double-click resets ──
  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !containerRef.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = containerRef.current.getBoundingClientRect();
    setDragging(true);
    const onMove = (ev: PointerEvent) =>
      setSplit(clampSplit(((ev.clientX - rect.left) / rect.width) * 100));
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      setDragging(false);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  const onDividerKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const next =
      e.key === 'ArrowLeft'
        ? split - step
        : e.key === 'ArrowRight'
          ? split + step
          : e.key === 'Home'
            ? SPLIT_MIN
            : e.key === 'End'
              ? SPLIT_MAX
              : e.key === 'Enter'
                ? SPLIT_DEFAULT
                : null;
    if (next === null) return;
    e.preventDefault();
    setSplit(clampSplit(next));
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface">
      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        {/* Both panes keep a minimum width, so a split dragged far to one side at a wide window
            still leaves the other pane usable when the window gets narrower. */}
        <div className="min-w-48 shrink grow-0 basis-(--sftp-split)">
          <FilePane side="local" />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file panes"
          aria-valuemin={SPLIT_MIN}
          aria-valuemax={SPLIT_MAX}
          aria-valuenow={Math.round(split)}
          tabIndex={0}
          title="Drag to resize, double-click to reset"
          onPointerDown={onDividerPointerDown}
          onKeyDown={onDividerKeyDown}
          onDoubleClick={() => setSplit(SPLIT_DEFAULT)}
          className={cx(
            'w-1 shrink-0 cursor-col-resize outline-none transition-colors duration-(--duration-fast) ease-standard',
            'hover:bg-accent focus-visible:bg-accent',
            dragging ? 'bg-accent' : 'bg-line'
          )}
        />

        <div className="min-w-48 flex-1">
          <FilePane side="remote" />
        </div>
      </div>

      <TransferPanel />
    </div>
  );
};
