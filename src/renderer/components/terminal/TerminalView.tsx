import React from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { useUIStore } from '../../stores/ui-store';
import { TerminalInstance } from './TerminalInstance';
import { ConnectionStatus } from './ConnectionStatus';
import { SquareTerminal } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// TerminalView — renders all terminal instances, showing only
// the active one while keeping inactive ones alive in the DOM
// ============================================================

export const TerminalView: React.FC = () => {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const sessions = useTerminalStore((s) => s.sessions);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const theme = useUIStore((s) => s.theme);

  const terminalTabs = tabs.filter(
    (tab) => tab.type === 'terminal' && tab.sessionId != null
  );

  const activeTab = terminalTabs.find((t) => t.id === activeTabId);
  const activeSession = activeTab
    ? sessions.find((s) => s.id === activeTab.sessionId)
    : null;

  const showOverlay =
    activeSession &&
    (activeSession.status === 'connecting' || activeSession.status === 'error');

  if (terminalTabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
          <Icon icon={SquareTerminal} size={48} strokeWidth={1.5} className="opacity-30" />
          <span className="text-sm">No active terminal</span>
          <span className="text-xs">
            Connect to a host or use Quick Connect to start a session
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 overflow-hidden bg-[var(--color-bg-primary)]">
      {terminalTabs.map((tab) => {
        const session = sessions.find((s) => s.id === tab.sessionId);
        // Only render a real xterm instance once the session is connected
        // (the sessionId is a real one from the backend, not a pending-* id)
        if (!session || session.status !== 'connected') return null;
        return (
          <TerminalInstance
            key={tab.sessionId!}
            sessionId={tab.sessionId!}
            isActive={tab.id === activeTabId}
            theme={theme.terminal}
          />
        );
      })}

      {showOverlay && activeSession && (
        <ConnectionStatus
          hostname={activeSession.hostname || activeSession.label}
          phase={activeSession.status === 'error' ? 'error' : 'connecting'}
          error={activeSession.error}
          onCancel={() => activeTab && removeTab(activeTab.id)}
        />
      )}
    </div>
  );
};
