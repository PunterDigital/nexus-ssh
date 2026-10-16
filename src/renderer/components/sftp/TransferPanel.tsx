import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  X,
} from 'lucide-react';
import type { TransferItem } from '../../../shared/types';
import { useSFTPStore } from '../../stores/sftp-store';
import { Icon } from '../common/Icon';
import { Button, IconButton, cx } from '../ui';

// ============================================================
// TransferPanel — collapsible transfer queue under the panes. One row per transfer: direction,
// file name, a native <progress> bar coloured by status, percentage, speed and bytes (the last
// two only where the panel is wide enough: it is an @container), and pause / resume / cancel.
// ============================================================

/** Format bytes into a human-readable size. */
function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '--';
  return `${formatSize(bytesPerSec)}/s`;
}

const STATUS_TEXT: Record<TransferItem['status'], string> = {
  queued: 'text-fg-muted',
  active: 'text-accent',
  paused: 'text-warning',
  completed: 'text-success',
  failed: 'text-danger',
};

// The progress-bar utility (tokens.css) draws the bar in the current text colour.
const STATUS_BAR: Record<TransferItem['status'], string> = {
  queued: 'text-fg-muted',
  active: 'text-accent',
  paused: 'text-warning',
  completed: 'text-success',
  failed: 'text-danger',
};

const TransferRow: React.FC<{ transfer: TransferItem }> = ({ transfer }) => {
  const pauseTransfer = useSFTPStore((s) => s.pauseTransfer);
  const resumeTransfer = useSFTPStore((s) => s.resumeTransfer);
  const cancelTransfer = useSFTPStore((s) => s.cancelTransfer);
  const percentage =
    transfer.status === 'completed'
      ? 100
      : transfer.size > 0
        ? Math.min(100, Math.round((transfer.transferred / transfer.size) * 100))
        : 0;
  const isUpload = transfer.direction === 'upload';
  const fullPath = isUpload ? transfer.localPath : transfer.remotePath;
  const filename = fullPath.split(/[\\/]/).pop() || fullPath;
  const running = transfer.status === 'active' || transfer.status === 'paused';

  // Transfer speed: exponential moving average over sampled deltas.
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
    const timeDelta = (now - last.time) / 1000;
    const byteDelta = transfer.transferred - last.transferred;
    if (timeDelta >= 0.2 && byteDelta >= 0) {
      const instantSpeed = byteDelta / timeDelta;
      // Blend 30% new reading with 70% previous
      setSpeed((prev) => (prev === 0 ? instantSpeed : prev * 0.7 + instantSpeed * 0.3));
      lastSampleRef.current = { time: now, transferred: transfer.transferred };
    }
  }, [transfer.transferred, transfer.status]);

  const handlePauseResume = useCallback(() => {
    if (transfer.status === 'active') pauseTransfer(transfer.id);
    else if (transfer.status === 'paused') resumeTransfer(transfer.id);
  }, [transfer.id, transfer.status, pauseTransfer, resumeTransfer]);

  const statusLabel =
    transfer.status === 'completed'
      ? 'Done'
      : transfer.status === 'failed'
        ? 'Failed'
        : transfer.status === 'queued'
          ? 'Queued'
          : `${percentage}%`;

  return (
    <li className="relative flex h-8 min-w-0 items-center gap-3 px-3 text-body-sm hover:bg-surface-hover">
      <span
        className={cx(
          'flex shrink-0 items-center',
          isUpload ? 'text-accent' : 'text-success'
        )}
        title={isUpload ? 'Upload' : 'Download'}
      >
        <Icon icon={isUpload ? ArrowUp : ArrowDown} size={14} />
        <span className="sr-only">{isUpload ? 'Upload' : 'Download'}</span>
      </span>

      <span className="min-w-0 flex-1 truncate font-code text-fg" title={fullPath}>
        {filename}
      </span>

      <progress
        aria-label={`${filename} progress`}
        value={percentage}
        max={100}
        className={cx(
          'progress-bar h-1.5 w-20 shrink-0 @md:w-40 @3xl:w-64',
          STATUS_BAR[transfer.status]
        )}
      />

      <span
        className={cx(
          'w-12 shrink-0 text-right tabular-nums',
          STATUS_TEXT[transfer.status]
        )}
        title={transfer.status === 'failed' ? transfer.error : undefined}
      >
        {statusLabel}
      </span>

      <span className="hidden w-20 shrink-0 text-right tabular-nums text-fg-muted @2xl:block">
        {transfer.status === 'active' ? formatSpeed(speed) : ''}
      </span>

      <span className="hidden w-36 shrink-0 text-right tabular-nums text-fg-muted @xl:block">
        {running
          ? `${formatSize(transfer.transferred)} / ${formatSize(transfer.size)}`
          : formatSize(transfer.size)}
      </span>

      <div className="flex w-13 shrink-0 items-center justify-end gap-1">
        {running && (
          <IconButton
            size="sm"
            icon={transfer.status === 'active' ? Pause : Play}
            label={`${transfer.status === 'active' ? 'Pause' : 'Resume'} ${filename}`}
            onClick={handlePauseResume}
          />
        )}
        {transfer.status !== 'completed' && (
          <IconButton
            size="sm"
            icon={X}
            label={`${transfer.status === 'failed' ? 'Remove' : 'Cancel'} ${filename}`}
            onClick={() => cancelTransfer(transfer.id)}
            className="hover:text-danger"
          />
        )}
      </div>
    </li>
  );
};

export const TransferPanel: React.FC = () => {
  const id = useId();
  const [collapsed, setCollapsed] = useState(false);
  const transfers = useSFTPStore((s) => s.transfers);
  const clearCompletedTransfers = useSFTPStore((s) => s.clearCompletedTransfers);

  const remaining = useMemo(
    () =>
      transfers.filter(
        (t) => t.status === 'queued' || t.status === 'active' || t.status === 'paused'
      ).length,
    [transfers]
  );
  const completedCount = useMemo(
    () => transfers.filter((t) => t.status === 'completed').length,
    [transfers]
  );

  if (transfers.length === 0) return null;

  return (
    <section
      aria-label="Transfers"
      className="@container flex shrink-0 flex-col border-t border-line bg-surface-sunken"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 px-1.5">
        <Button
          variant="ghost"
          size="sm"
          icon={collapsed ? ChevronRight : ChevronDown}
          aria-expanded={!collapsed}
          aria-controls={`${id}-list`}
          onClick={() => setCollapsed((c) => !c)}
          className="min-w-0"
        >
          Transfers
          {remaining > 0 && (
            <span className="truncate font-normal text-fg-muted">
              · {remaining} file{remaining !== 1 ? 's' : ''} remaining
            </span>
          )}
        </Button>
        <div className="flex-1" />
        {completedCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => clearCompletedTransfers()}>
            Clear completed
          </Button>
        )}
      </div>

      {!collapsed && (
        <ul
          id={`${id}-list`}
          className="max-h-40 overflow-y-auto border-t border-line pb-1 scrollbar-thin"
        >
          {transfers.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
        </ul>
      )}
    </section>
  );
};
