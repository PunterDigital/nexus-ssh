import React, { useState, useCallback } from 'react';
import { useSyncStatus } from '../../hooks';

// ============================================================
// SyncStatusBadge — shows current sync state
// ============================================================

type SyncState = 'syncing' | 'synced' | 'error' | 'disabled';

interface SyncStatusData {
  state: SyncState;
  lastSyncAt?: string | null;
  error?: string | null;
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

export const SyncStatusBadge: React.FC = () => {
  const [syncData, setSyncData] = useState<SyncStatusData>({
    state: 'disabled',
  });

  const handleSyncStatus = useCallback((status: unknown) => {
    const data = status as SyncStatusData;
    setSyncData(data);
  }, []);

  useSyncStatus(handleSyncStatus);

  const { state, lastSyncAt, error } = syncData;

  const renderIcon = () => {
    switch (state) {
      case 'syncing':
        return (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="animate-spin text-[var(--color-accent)]"
          >
            <path d="M6 1v2M6 9v2M1 6h2M9 6h2" />
            <path d="M2.4 2.4l1.4 1.4M8.2 8.2l1.4 1.4" opacity="0.5" />
          </svg>
        );
      case 'synced':
        return (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="var(--color-success)"
            strokeWidth="1.5"
          >
            <polyline points="2.5,6 5,8.5 9.5,3.5" />
          </svg>
        );
      case 'error':
        return (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="var(--color-danger)"
            strokeWidth="1.5"
          >
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        );
      case 'disabled':
      default:
        return (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth="1.5"
          >
            <line x1="3" y1="6" x2="9" y2="6" />
          </svg>
        );
    }
  };

  const renderLabel = () => {
    switch (state) {
      case 'syncing':
        return <span className="text-[var(--color-accent)]">Syncing...</span>;
      case 'synced':
        return (
          <span className="text-[var(--color-text-muted)]">
            Synced {lastSyncAt ? getRelativeTime(lastSyncAt) : ''}
          </span>
        );
      case 'error':
        return (
          <span className="text-[var(--color-danger)]" title={error ?? undefined}>
            Sync failed
          </span>
        );
      case 'disabled':
      default:
        return <span className="text-[var(--color-text-muted)]">Sync off</span>;
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {renderIcon()}
      <span className="text-xs">{renderLabel()}</span>
    </div>
  );
};
