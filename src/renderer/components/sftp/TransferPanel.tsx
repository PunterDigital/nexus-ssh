import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { TransferItem } from '../../../shared/types';
import { useSFTPStore } from '../../stores/sftp-store';
import { ChevronRight, CirclePause, CirclePlay, X } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// TransferPanel — collapsible transfer queue at the bottom
// ============================================================

/** Format bytes into human-readable size */
function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Transfer speed estimate — simple display helper */
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '--';
  return `${formatSize(bytesPerSec)}/s`;
}

const STATUS_COLORS: Record<TransferItem['status'], string> = {
  queued: 'var(--color-text-muted)',
  active: 'var(--color-accent)',
  paused: 'var(--color-warning)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
};

const STATUS_BAR_COLORS: Record<TransferItem['status'], string> = {
  queued: 'var(--color-text-muted)',
  active: 'var(--color-accent)',
  paused: 'var(--color-warning)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
};

interface TransferRowProps {
  transfer: TransferItem;
}

const TransferRow: React.FC<TransferRowProps> = ({ transfer }) => {
  const { pauseTransfer, resumeTransfer, cancelTransfer } = useSFTPStore();
  const percentage = transfer.size > 0 ? Math.round((transfer.transferred / transfer.size) * 100) : 0;
  const filename = transfer.localPath.split(/[\\/]/).pop() ?? transfer.localPath;
  const isUpload = transfer.direction === 'upload';

  // Real transfer speed — exponential moving average over sampled deltas
  const [speed, setSpeed] = useState(0);
  const lastSampleRef = useRef<{ time: number; transferred: number } | null>(null);

  useEffect(() => {
    if (transfer.status !== 'active') {
      lastSampleRef.current = null;
      if (transfer.status !== 'paused') setSpeed(0);
      return;
    }

    const now = Date.now();
    const last = lastSampleRef.current;

    if (!last) {
      lastSampleRef.current = { time: now, transferred: transfer.transferred };
      return;
    }

    const timeDelta = (now - last.time) / 1000; // seconds
    const byteDelta = transfer.transferred - last.transferred;

    if (timeDelta >= 0.2 && byteDelta >= 0) {
      const instantSpeed = byteDelta / timeDelta;
      // EMA smoothing: blend 30% new reading with 70% previous
      setSpeed((prev) => (prev === 0 ? instantSpeed : prev * 0.7 + instantSpeed * 0.3));
      lastSampleRef.current = { time: now, transferred: transfer.transferred };
    }
  }, [transfer.transferred, transfer.status]);

  const handlePauseResume = useCallback(() => {
    if (transfer.status === 'active') {
      pauseTransfer(transfer.id);
    } else if (transfer.status === 'paused') {
      resumeTransfer(transfer.id);
    }
  }, [transfer.id, transfer.status, pauseTransfer, resumeTransfer]);

  const handleCancel = useCallback(() => {
    cancelTransfer(transfer.id);
  }, [transfer.id, cancelTransfer]);

  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-[var(--color-bg-tertiary)] transition-colors"
    >
      {/* Direction arrow */}
      <span
        className="flex-shrink-0 text-sm"
        style={{ color: isUpload ? 'var(--color-accent)' : 'var(--color-success)' }}
        title={isUpload ? 'Upload' : 'Download'}
      >
        {isUpload ? '\u2191' : '\u2193'}
      </span>

      {/* Filename */}
      <span
        className="truncate min-w-0 w-40"
        style={{ color: 'var(--color-text-primary)' }}
        title={isUpload ? transfer.localPath : transfer.remotePath}
      >
        {filename}
      </span>

      {/* Progress bar */}
      <div className="flex-1 min-w-[80px]">
        <div className="transfer-progress">
          <div
            className="transfer-progress-bar"
            style={{
              width: `${transfer.status === 'completed' ? 100 : percentage}%`,
              backgroundColor: STATUS_BAR_COLORS[transfer.status],
            }}
          />
        </div>
      </div>

      {/* Percentage */}
      <span
        className="w-10 text-right flex-shrink-0"
        style={{ color: STATUS_COLORS[transfer.status] }}
      >
        {transfer.status === 'completed' ? '100%' : transfer.status === 'failed' ? 'ERR' : `${percentage}%`}
      </span>

      {/* Speed */}
      <span
        className="w-16 text-right flex-shrink-0"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {transfer.status === 'active' ? formatSpeed(speed) : ''}
      </span>

      {/* Size / Progress bytes */}
      <span
        className="w-36 text-right flex-shrink-0 tabular-nums"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {transfer.status === 'active' || transfer.status === 'paused'
          ? `${formatSize(transfer.transferred)} / ${formatSize(transfer.size)}`
          : formatSize(transfer.size)}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {(transfer.status === 'active' || transfer.status === 'paused') && (
          <button
            className="btn-ghost w-5 h-5 flex items-center justify-center rounded text-[10px]"
            onClick={handlePauseResume}
            title={transfer.status === 'active' ? 'Pause' : 'Resume'}
          >
            {transfer.status === 'active' ? (
              <Icon icon={CirclePause} size={12} />
            ) : (
              <Icon icon={CirclePlay} size={12} />
            )}
          </button>
        )}
        {transfer.status !== 'completed' && (
          <button
            className="btn-ghost w-5 h-5 flex items-center justify-center rounded text-[10px]"
            onClick={handleCancel}
            title="Cancel"
            style={{ color: 'var(--color-danger)' }}
          >
            <Icon icon={X} size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

export const TransferPanel: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const transfers = useSFTPStore((s) => s.transfers);
  const clearCompletedTransfers = useSFTPStore((s) => s.clearCompletedTransfers);

  const remaining = useMemo(
    () => transfers.filter((t) => t.status === 'queued' || t.status === 'active' || t.status === 'paused').length,
    [transfers],
  );

  const completedCount = useMemo(
    () => transfers.filter((t) => t.status === 'completed').length,
    [transfers],
  );

  if (transfers.length === 0) return null;

  return (
    <div
      className="border-t flex flex-col"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-bg-secondary)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-bg-tertiary)] transition-colors"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => setCollapsed((c) => !c)}
        >
          <Icon icon={ChevronRight} size={12} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          <span>
            Transfers
            {remaining > 0 && (
              <span style={{ color: 'var(--color-text-muted)' }}>
                {' '}&middot; {remaining} file{remaining !== 1 ? 's' : ''} remaining
              </span>
            )}
          </span>
        </button>
        {completedCount > 0 && (
          <button
            type="button"
            className="btn-ghost text-[10px] px-1.5 py-0.5 rounded"
            onClick={() => clearCompletedTransfers()}
          >
            Clear completed
          </button>
        )}
      </div>

      {/* Transfer list */}
      {!collapsed && (
        <div className="max-h-40 overflow-y-auto scrollbar-thin">
          {transfers.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
        </div>
      )}
    </div>
  );
};
