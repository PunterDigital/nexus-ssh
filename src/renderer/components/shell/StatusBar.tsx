import React from 'react';
import { useTerminalStore } from '../../stores';
import { cx } from '../ui';

// ============================================================
// StatusBar — active connection, open session count, app version.
// (Sync state lives in the sidebar, where it reflects the real engine status.)
// ============================================================

export const StatusBar: React.FC = () => {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const connectedCount = sessions.filter((s) => s.connected).length;

  return (
    <footer className="no-select flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-sunken px-3 text-caption text-fg-muted">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={cx(
            'size-1.5 shrink-0 rounded-full',
            activeSession?.connected ? 'bg-success' : 'bg-fg-muted'
          )}
          aria-hidden="true"
        />
        <span className="truncate">
          {activeSession
            ? `${activeSession.label} ${activeSession.connected ? '(connected)' : '(disconnected)'}`
            : 'No active connection'}
        </span>
      </span>

      <span className="flex-1" />

      {connectedCount > 0 && (
        <span className="shrink-0">
          {connectedCount} session{connectedCount !== 1 ? 's' : ''}
        </span>
      )}
      <span className="shrink-0">Nexus v{__APP_VERSION__}</span>
    </footer>
  );
};
