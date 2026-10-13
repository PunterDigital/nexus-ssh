import React from 'react';

// ============================================================
// SyncHistoryLog — Scrollable list of sync events
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

const DIRECTION_ICONS: Record<SyncEvent['direction'], { arrow: string; label: string }> = {
  push: { arrow: '\u2191', label: 'Push' },
  pull: { arrow: '\u2193', label: 'Pull' },
};

const OUTCOME_STYLES: Record<SyncEvent['outcome'], { symbol: string; color: string; bgColor: string; label: string }> = {
  success: {
    symbol: '\u2713',
    color: 'var(--color-success)',
    bgColor: 'rgba(158, 206, 106, 0.15)',
    label: 'Success',
  },
  conflict: {
    symbol: '\u26A0',
    color: 'var(--color-warning)',
    bgColor: 'rgba(224, 175, 104, 0.15)',
    label: 'Conflict',
  },
  error: {
    symbol: '\u2717',
    color: 'var(--color-danger)',
    bgColor: 'rgba(247, 118, 142, 0.15)',
    label: 'Error',
  },
};

export const SyncHistoryLog: React.FC<SyncHistoryLogProps> = ({ events }) => {
  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          No sync history yet.
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1 max-h-80 overflow-y-auto scrollbar-thin rounded-md border"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {events.map((event) => {
        const dir = DIRECTION_ICONS[event.direction];
        const outcome = OUTCOME_STYLES[event.outcome];

        return (
          <div
            key={event.id}
            className="flex items-center gap-3 px-3 py-2 text-xs"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            {/* Timestamp */}
            <span
              className="font-mono shrink-0 w-36"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {formatTimestamp(event.timestamp)}
            </span>

            {/* Direction */}
            <span
              className="shrink-0 w-5 text-center font-bold"
              style={{ color: 'var(--color-accent)' }}
              title={dir.label}
            >
              {dir.arrow}
            </span>

            {/* Outcome badge */}
            <span
              className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ backgroundColor: outcome.bgColor, color: outcome.color }}
            >
              {outcome.symbol} {outcome.label}
            </span>

            {/* Details */}
            <span
              className="truncate flex-1"
              style={{ color: 'var(--color-text-secondary)' }}
              title={event.details}
            >
              {event.details}
            </span>
          </div>
        );
      })}
    </div>
  );
};
