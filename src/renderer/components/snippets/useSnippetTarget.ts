import { useMemo } from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { useVaultStore } from '../../stores/vault-store';
import type { SnippetContext } from './variables';

/** The terminal a snippet runs in: the active session, if it is a connected terminal tab. */
export interface SnippetTarget {
  sessionId: string;
  label: string;
  hostname: string;
  context: SnippetContext;
}

/**
 * The active session counts only when its tab is a terminal and it is connected: an SFTP tab's
 * session has no shell, and a session that is still connecting (or dropped) can't take input.
 */
export function useSnippetTarget(): SnippetTarget | null {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const sessions = useTerminalStore((s) => s.sessions);
  const tabs = useTerminalStore((s) => s.tabs);
  const hosts = useVaultStore((s) => s.hosts);
  const groups = useVaultStore((s) => s.groups);

  return useMemo(() => {
    if (!activeSessionId) return null;
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session?.connected) return null;
    if (!tabs.some((t) => t.sessionId === activeSessionId && t.type === 'terminal')) return null;
    const host = hosts.find((h) => h.id === session.hostId);
    // A host without a username connects with its group's default one.
    const group = host?.group_id ? groups.find((g) => g.id === host.group_id) : undefined;
    return {
      sessionId: session.id,
      label: host?.label ?? session.label,
      hostname: host?.hostname ?? session.hostname ?? '',
      context: {
        hostname: host?.hostname ?? session.hostname,
        username: host?.username || group?.default_username || undefined,
        port: host?.port,
      },
    };
  }, [activeSessionId, sessions, tabs, hosts, groups]);
}
