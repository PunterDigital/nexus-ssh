import React, { useCallback, useEffect } from 'react';
import { useUIStore, useTerminalStore, useVaultStore } from './stores';
import { useSystemLock } from './hooks';
import type { ViewType } from './stores';
import { applyTheme } from './styles/themes';
import { LockScreen, Sidebar, ConnectionsView } from './components/vault';
import { TerminalView, ConnectionStatus } from './components/terminal';
import { SFTPBrowser } from './components/sftp/SFTPBrowser';
import { KeychainView } from './components/keychain/KeychainView';
import { SnippetsPanel } from './components/common/SnippetsPanel';
import { SettingsPanel } from './components/common/SettingsPanel';

// ============================================================
// Nexus SSH Client — App Shell
// ============================================================

/** Header bar with app name, view tabs, session tabs, lock, settings. */
function HeaderBar(): React.ReactElement {
  const currentView = useUIStore((s) => s.currentView);
  const setView = useUIStore((s) => s.setView);
  const setLockScreenVisible = useUIStore((s) => s.setLockScreenVisible);
  const lockVault = useVaultStore((s) => s.lockVault);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const removeTab = useTerminalStore((s) => s.removeTab);

  const handleLock = async () => {
    await lockVault();
    setLockScreenVisible(true);
  };

  const handleSessionTabClick = (tabId: string) => {
    setActiveTab(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.type === 'sftp') {
      setView('sftp');
    } else {
      setView('terminal');
    }
  };

  const handleCloseSessionTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    const closingTab = tabs.find((t) => t.id === tabId);
    removeTab(tabId);
    // If no tabs left, go back to the hosts list for the current mode
    if (tabs.length <= 1) {
      setView(closingTab?.type === 'sftp' ? 'sftp' : 'connections');
    }
  };

  return (
    <div className="flex h-10 items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3">
      {/* App name */}
      <span className="mr-3 text-sm font-bold tracking-wide text-[var(--color-accent)]">
        Nexus
      </span>

      {/* Fixed nav tabs */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setView('connections')}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            currentView === 'connections'
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'
          }`}
        >
          Hosts
        </button>
        <button
          onClick={() => setView('sftp')}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            currentView === 'sftp'
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'
          }`}
        >
          SFTP
        </button>
      </div>

      {/* Divider between nav and session tabs */}
      {tabs.length > 0 && (
        <div className="mx-2 h-4 w-px bg-[var(--color-border)]" />
      )}

      {/* Session tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hidden">
        {tabs.map((tab) => {
          const isActive = currentView === 'terminal' && activeTabId === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleSessionTabClick(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) handleCloseSessionTab(e, tab.id);
              }}
              className={`group flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                isActive
                  ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {/* Colour dot */}
              {tab.colour && (
                <span
                  className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: tab.colour }}
                />
              )}
              {/* Terminal icon */}
              {!tab.colour && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 opacity-50">
                  <polyline points="2,3 5,6 2,9" />
                  <line x1="7" y1="9" x2="10" y2="9" />
                </svg>
              )}
              <span className="max-w-[100px] truncate">{tab.label}</span>
              {/* Close button */}
              <span
                onClick={(e) => handleCloseSessionTab(e, tab.id)}
                className="ml-0.5 flex-shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--color-bg-primary)] group-hover:opacity-100"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="1.5" y1="1.5" x2="6.5" y2="6.5" />
                  <line x1="6.5" y1="1.5" x2="1.5" y2="6.5" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Lock button */}
      <button
        onClick={handleLock}
        className="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
        title="Lock vault"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="7" width="10" height="7" rx="1" />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" />
        </svg>
      </button>

      {/* Settings button */}
      <button
        onClick={() => setView('settings')}
        className={`rounded p-1 transition-colors ${
          currentView === 'settings'
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
        }`}
        title="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19.14 12.94a7.49 7.49 0 0 0 .05-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.5 7.5 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.5 7.5 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.69 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.49 7.49 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96a7.5 7.5 0 0 0 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7.5 7.5 0 0 0 1.63-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  );
}

/** Content panels for each view type. */
function MainContent(): React.ReactElement {
  const currentView = useUIStore((s) => s.currentView);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const sessions = useTerminalStore((s) => s.sessions);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const setView = useUIStore((s) => s.setView);

  switch (currentView) {
    case 'connections':
      return <ConnectionsView mode="ssh" />;

    case 'terminal':
      return <TerminalView />;

    case 'sftp': {
      // Find the active SFTP tab and its session
      const activeTab = tabs.find((t) => t.id === activeTabId && t.type === 'sftp');
      const activeSession = activeTab
        ? sessions.find((s) => s.id === activeTab.sessionId)
        : null;

      // SFTP session is connecting or errored — show the overlay
      if (
        activeSession &&
        (activeSession.status === 'connecting' || activeSession.status === 'error')
      ) {
        return (
          <div className="relative flex flex-1 overflow-hidden bg-[var(--color-bg-primary)]">
            <ConnectionStatus
              hostname={activeSession.hostname || activeSession.label}
              phase={activeSession.status === 'error' ? 'error' : 'connecting'}
              error={activeSession.error}
              onCancel={() => {
                if (activeTab) {
                  removeTab(activeTab.id);
                  if (tabs.length <= 1) setView('sftp');
                }
              }}
            />
          </div>
        );
      }

      if (activeSession && activeSession.status === 'connected') {
        return <SFTPBrowser sessionId={activeSession.id} />;
      }

      // No active SFTP tab at all — show the host picker
      return <ConnectionsView mode="sftp" />;
    }

    case 'keychain':
      return <KeychainView />;

    case 'snippets':
      return <SnippetsPanel />;

    case 'settings':
      return <SettingsPanel />;

    default:
      return <div className="flex-1 bg-[var(--color-bg-primary)]" />;
  }
}

/** Status bar at the bottom of the app. */
function StatusBar(): React.ReactElement {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const connectedCount = sessions.filter((s) => s.connected).length;

  return (
    <div className="flex h-6 items-center border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 text-[10px]">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            activeSession?.connected
              ? 'bg-[var(--color-success)]'
              : 'bg-[var(--color-text-muted)]'
          }`}
        />
        <span className="text-[var(--color-text-muted)]">
          {activeSession
            ? `${activeSession.label} ${activeSession.connected ? '(connected)' : '(disconnected)'}`
            : 'No active connection'}
        </span>
      </div>

      <div className="flex-1" />

      {connectedCount > 0 && (
        <span className="mr-3 text-[var(--color-text-muted)]">
          {connectedCount} session{connectedCount !== 1 ? 's' : ''}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
        <span className="text-[var(--color-text-muted)]">Synced</span>
      </div>

      <span className="ml-3 text-[var(--color-text-muted)]">Nexus v0.1.0</span>
    </div>
  );
}

/** Root application component. */
export default function App(): React.ReactElement {
  const lockScreenVisible = useUIStore((s) => s.lockScreenVisible);
  const theme = useUIStore((s) => s.theme);
  const currentView = useUIStore((s) => s.currentView);
  const setView = useUIStore((s) => s.setView);
  const setLockScreenVisible = useUIStore((s) => s.setLockScreenVisible);
  const lockVault = useVaultStore((s) => s.lockVault);
  const loadPersistedTheme = useUIStore((s) => s.loadPersistedTheme);

  // Apply UI preferences (theme, font size) on mount — they're stored
  // app-wide in app-settings.json, not inside the encrypted vault, so
  // they're available before vault unlock.
  useEffect(() => {
    document.documentElement.style.fontSize = '16px';
    loadPersistedTheme();
    (async () => {
      try {
        const saved = (await window.nexus.appSettings.get('uiFontSize')) as
          | number
          | null;
        if (typeof saved === 'number') {
          document.documentElement.style.fontSize = `${saved}px`;
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Lock vault on system lock
  const handleSystemLock = useCallback(() => {
    lockVault();
    setLockScreenVisible(true);
  }, [lockVault, setLockScreenVisible]);

  useSystemLock(handleSystemLock);

  if (lockScreenVisible) {
    return <LockScreen />;
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* Header with inline session tabs */}
      <HeaderBar />

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <MainContent />
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}
