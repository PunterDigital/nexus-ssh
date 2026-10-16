import React, { useCallback, useEffect } from 'react';
import { useUIStore, useTerminalStore, useVaultStore, useSFTPStore } from './stores';
import { useTerminalPrefsCache, useVaultLocked } from './hooks';
import { applyTheme } from './styles/themes';
import { LockScreen, ConnectionsView, SwitchVaultHost } from './components/vault';
import { AppHeader, Sidebar, StatusBar } from './components/shell';
import { TerminalView, ConnectionStatus, HostKeyPromptHost } from './components/terminal';
import { SFTPBrowser } from './components/sftp/SFTPBrowser';
import { KeychainView } from './components/keychain/KeychainView';
import { SnippetsPanel } from './components/snippets/SnippetsPanel';
import { SettingsPanel } from './components/common/SettingsPanel';
import { ToastHost } from './components/common/ToastHost';
import { UpdateBanner } from './components/common/UpdateBanner';

// ============================================================
// Nexus SSH Client — App Shell (layout: components/shell, #2365)
// ============================================================

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
          <div className="relative flex flex-1 overflow-hidden bg-surface">
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
      return <div className="flex-1 bg-surface" />;
  }
}

/** Root application component. */
export default function App(): React.ReactElement {
  const lockScreenVisible = useUIStore((s) => s.lockScreenVisible);
  const theme = useUIStore((s) => s.theme);
  const setView = useUIStore((s) => s.setView);
  const setLockScreenVisible = useUIStore((s) => s.setLockScreenVisible);
  const loadPersistedTheme = useUIStore((s) => s.loadPersistedTheme);
  const loadPersistedLayout = useUIStore((s) => s.loadPersistedLayout);

  // Apply UI preferences (theme, font size) on mount — they're stored
  // app-wide in app-settings.json, not inside the encrypted vault, so
  // they're available before vault unlock.
  useEffect(() => {
    document.documentElement.style.fontSize = '16px';
    loadPersistedTheme();
    loadPersistedLayout();
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

  // The main process locked the vault (idle, sleep, OS screen lock): drop every bit of
  // vault-derived state and go back to the lock screen.
  const handleVaultLocked = useCallback(() => {
    useVaultStore.getState().reset();
    useTerminalStore.getState().reset();
    useSFTPStore.getState().reset();
    setView('connections');
    setLockScreenVisible(true);
  }, [setView, setLockScreenVisible]);

  useVaultLocked(handleVaultLocked);
  useTerminalPrefsCache(!lockScreenVisible);

  if (lockScreenVisible) {
    return (
      <>
        <LockScreen />
        <UpdateBanner />
        <ToastHost />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface font-ui text-fg">
      {/* Header: session tabs, lock, settings */}
      <AppHeader />

      {/* Body: sidebar + main content. min-w-0 / min-h-0 let the main area shrink instead of
          pushing content off-screen. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <MainContent />
        </main>
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* "Switch vault" confirmation (closes the sessions, then shows the vault picker) */}
      <SwitchVaultHost />

      {/* Unknown / changed host keys wait here for the user's decision */}
      <HostKeyPromptHost />

      {/* "New version" card (src/main/updater) */}
      <UpdateBanner />

      {/* addNotification() messages */}
      <ToastHost />
    </div>
  );
}
