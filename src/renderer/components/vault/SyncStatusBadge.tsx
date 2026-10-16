import React, { useState, useCallback } from 'react';
import { useSyncStatus } from '../../hooks';
import { Check, Minus, RefreshCw, X } from 'lucide-react';
import { Icon } from '../common/Icon';

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
        return <Icon icon={RefreshCw} size={12} className="animate-spin text-[var(--color-accent)]" />;
      case 'synced':
        return <Icon icon={Check} size={12} color="var(--color-success)" />;
      case 'error':
        return <Icon icon={X} size={12} color="var(--color-danger)" />;
      case 'disabled':
      default:
        return <Icon icon={Minus} size={12} color="var(--color-text-muted)" />;
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
