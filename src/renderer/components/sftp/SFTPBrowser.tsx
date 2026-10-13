import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSFTPStore } from '../../stores/sftp-store';
import { useSFTPTransferProgress } from '../../hooks/use-ipc';
import { FilePane } from './FilePane';
import { TransferPanel } from './TransferPanel';

// ============================================================
// SFTPBrowser — main dual-pane SFTP file browser
// ============================================================

interface SFTPBrowserProps {
  sessionId: string;
}

const MIN_PANE_WIDTH = 200;

export const SFTPBrowser: React.FC<SFTPBrowserProps> = ({ sessionId }) => {
  const {
    setActiveSessionId,
    navigateLocal,
    navigateRemote,
    localPath,
    remotePath,
    updateTransferProgress,
    completeTransfer,
    failTransfer,
  } = useSFTPStore();

  const [splitPosition, setSplitPosition] = useState(50); // percentage
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Initialize session
  useEffect(() => {
    setActiveSessionId(sessionId);
    navigateRemote('/');

    // Initialize local pane with the user's home directory
    (async () => {
      try {
        const home = await window.nexus.fs.home();
        navigateLocal(home);
      } catch {
        // Fallback to the current localPath if fs.home fails
        navigateLocal(localPath);
      }
    })();

    return () => {
      setActiveSessionId(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Listen for transfer progress from main process
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
          updateTransferProgress(p.id, p.transferred, p.size);
        }
      },
      [updateTransferProgress, completeTransfer, failTransfer],
    ),
  );

  // ── Resizable divider ─────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = (x / rect.width) * 100;
      const clamped = Math.max(
        (MIN_PANE_WIDTH / rect.width) * 100,
        Math.min(100 - (MIN_PANE_WIDTH / rect.width) * 100, pct),
      );
      setSplitPosition(clamped);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-full" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b text-xs"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-bg-secondary)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <div className="flex items-center gap-4">
          <span>
            <span style={{ color: 'var(--color-text-muted)' }}>Local:</span>{' '}
            <span className="font-mono">{localPath === '__drives__' ? 'This PC' : localPath}</span>
          </span>
          <span>
            <span style={{ color: 'var(--color-text-muted)' }}>Remote:</span>{' '}
            <span className="font-mono">{remotePath}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Settings gear placeholder */}
          <button
            className="btn-ghost w-6 h-6 flex items-center justify-center rounded"
            title="SFTP Settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Dual pane area */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
        {/* Local pane (left) */}
        <div style={{ width: `${splitPosition}%` }} className="min-w-0">
          <FilePane side="local" />
        </div>

        {/* Resize handle */}
        <div
          className="resize-handle flex-shrink-0"
          onMouseDown={handleMouseDown}
          style={{
            borderLeft: '1px solid var(--color-border)',
            borderRight: '1px solid var(--color-border)',
          }}
        />

        {/* Remote pane (right) */}
        <div style={{ width: `${100 - splitPosition}%` }} className="min-w-0">
          <FilePane side="remote" />
        </div>
      </div>

      {/* Transfer panel (bottom) */}
      <TransferPanel />
    </div>
  );
};
