import React from 'react';
import { Lock, Settings } from 'lucide-react';
import { useUIStore, useVaultStore } from '../../stores';
import { IconButton } from '../ui';
import { SessionTabs } from './SessionTabs';

// ============================================================
// AppHeader — app name, open session tabs, lock and settings (#2365).
// Navigation between views lives in the sidebar; the header is for sessions.
// ============================================================

export const AppHeader: React.FC = () => {
  const currentView = useUIStore((s) => s.currentView);
  const setView = useUIStore((s) => s.setView);
  const setLockScreenVisible = useUIStore((s) => s.setLockScreenVisible);
  const lockVault = useVaultStore((s) => s.lockVault);

  const handleLock = async () => {
    await lockVault();
    setLockScreenVisible(true);
  };

  const settingsActive = currentView === 'settings';

  return (
    <header className="no-select flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface-sunken px-3">
      <span className="shrink-0 text-body font-semibold tracking-wide text-accent">
        Nexus
      </span>
      <div className="h-5 w-px shrink-0 bg-line" aria-hidden="true" />

      <SessionTabs />

      <div className="flex shrink-0 items-center gap-1">
        <IconButton icon={Lock} label="Lock vault" onClick={handleLock} />
        <IconButton
          icon={Settings}
          label="Settings"
          aria-current={settingsActive ? 'page' : undefined}
          className={
            settingsActive
              ? 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent'
              : undefined
          }
          onClick={() => setView('settings')}
        />
      </div>
    </header>
  );
};
