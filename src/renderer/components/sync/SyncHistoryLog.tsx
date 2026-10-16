import React from 'react';
import { ArrowDown, ArrowUp, CircleCheck, CircleX, History, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Icon } from '../common/Icon';
import { EmptyState, cx } from '../ui';

// ============================================================
// SyncHistoryLog — the latest sync events, newest first (design system: #2367)
// ============================================================

export interface SyncEvent {
  id: string;
  timestamp: string;
  direction: 'push' | 'pull';
  outcome: 'success' | 'conflict' | 'error';
  details: string;
}

interface SyncHistoryLogProps {
  events: SyncEvent[];
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

const DIRECTION: Record<SyncEvent['direction'], { icon: LucideIcon; label: string }> = {
  push: { icon: ArrowUp, label: 'Push' },
  pull: { icon: ArrowDown, label: 'Pull' },
};

const OUTCOME: Record<SyncEvent['outcome'], { icon: LucideIcon; label: string; className: string }> = {
  success: { icon: CircleCheck, label: 'Success', className: 'bg-success-soft text-success' },
  conflict: { icon: TriangleAlert, label: 'Conflict', className: 'bg-warning-soft text-warning' },
  error: { icon: CircleX, label: 'Error', className: 'bg-danger-soft text-danger' },
};

export const SyncHistoryLog: React.FC<SyncHistoryLogProps> = ({ events }) => {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No syncs yet"
        description="Each push and pull of this vault is listed here, with what happened."
      />
    );
  }

  return (
    <ul aria-label="Sync history" className="scrollbar-thin flex max-h-80 flex-col overflow-y-auto">
      {events.map((event) => {
        const dir = DIRECTION[event.direction];
        const outcome = OUTCOME[event.outcome];
        return (
          <li
            key={event.id}
            className="relative flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
          >
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-secondary"
              title={dir.label}
            >
              <Icon icon={dir.icon} size={14} />
              <span className="sr-only">{dir.label}</span>
            </span>

            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-sm text-fg" title={event.details}>
                {event.details}
              </span>
              <time dateTime={event.timestamp} className="text-caption text-fg-muted">
                {formatTimestamp(event.timestamp)}
              </time>
            </div>

            <span
              className={cx(
                'inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption font-medium',
                outcome.className,
              )}
            >
              <Icon icon={outcome.icon} size={12} />
              {outcome.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
};
