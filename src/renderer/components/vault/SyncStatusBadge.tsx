import React, { useState, useCallback, useEffect } from 'react';
import { useSyncStatus } from '../../hooks';
import { Check, Minus, RefreshCw, X } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from '../ui';

// ============================================================
// SyncStatusBadge — shows current sync state (sidebar footer; icon only on the rail)
// ============================================================

type SyncState = 'syncing' | 'synced' | 'error' | 'disabled';

interface SyncStatusData {
  state: SyncState;
  lastSyncAt?: string | null;
  error?: string | null;
}

/** The engine's status (sync:get-status / sync:status-update) → what the badge shows. */
function toBadgeData(raw: unknown): SyncStatusData {
  const s = (raw ?? {}) as {
    state?: SyncState;
    syncing?: boolean;
    lastSyncAt?: string | null;
    error?: string | null;
    lastError?: string | null;
  };
  const error = s.error ?? s.lastError ?? null;
  const state: SyncState =
    s.state ?? (s.syncing ? 'syncing' : error ? 'error' : s.lastSyncAt ? 'synced' : 'disabled');
  return { state, lastSyncAt: s.lastSyncAt ?? null, error };
}

function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const ICON = {
  syncing: { icon: RefreshCw, className: 'animate-spin text-accent' },
  synced: { icon: Check, className: 'text-success' },
  error: { icon: X, className: 'text-danger' },
  disabled: { icon: Minus, className: 'text-fg-muted' },
} as const;

export const SyncStatusBadge: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [syncData, setSyncData] = useState<SyncStatusData>({ state: 'disabled' });

  const handleSyncStatus = useCallback((status: unknown) => {
    setSyncData(toBadgeData(status));
  }, []);

  useSyncStatus(handleSyncStatus);

  // Start from the engine's current status rather than "off" until the next event.
  useEffect(() => {
    let cancelled = false;
    window.nexus.sync
      .getStatus()
      .then((status: unknown) => {
        if (!cancelled) setSyncData(toBadgeData(status));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const { state, lastSyncAt, error } = syncData;
  const label =
    state === 'syncing'
      ? 'Syncing…'
      : state === 'synced'
        ? `Synced${lastSyncAt ? ` ${getRelativeTime(lastSyncAt)}` : ''}`
        : state === 'error'
          ? 'Sync failed'
          : 'Sync off';
  const tooltip = state === 'error' && error ? `${label}: ${error}` : label;
  const { icon, className } = ICON[state];

  if (compact) {
    return (
      <div title={tooltip} className="flex size-8 items-center justify-center">
        <Icon icon={icon} size={14} className={className} />
        <span className="sr-only">{tooltip}</span>
      </div>
    );
  }

  return (
    // Not role="status": E2E finds toasts by that role (ToastHost).
    <div title={tooltip} className="flex h-9 items-center gap-2 px-3 text-body-sm">
      <Icon icon={icon} size={14} className={cx('shrink-0', className)} />
      <span
        className={cx(
          'truncate',
          state === 'syncing' ? 'text-accent' : state === 'error' ? 'text-danger' : 'text-fg-muted',
        )}
      >
        {label}
      </span>
    </div>
  );
};
