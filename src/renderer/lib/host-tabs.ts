import type { SSHSession } from '../../shared/types';
import type { TerminalTab } from '../stores/terminal-store';

// ============================================================
// Which open tabs belong to a host (#3098)
//
// Deleting a host closes its terminal and SFTP tabs. A tab points at a session, and the
// session carries the host id (pending sessions included, so a tab still connecting goes too).
// ============================================================

export function tabsForHost(tabs: readonly TerminalTab[], sessions: readonly SSHSession[], hostId: string): TerminalTab[] {
  const sessionIds = new Set(sessions.filter((s) => s.hostId === hostId).map((s) => s.id));
  return tabs.filter((t) => t.sessionId !== null && sessionIds.has(t.sessionId));
}

/** "1 open tab" / "2 open tabs", for the confirmation copy. */
export function openTabsLabel(count: number): string {
  return count === 1 ? '1 open tab' : `${count} open tabs`;
}
