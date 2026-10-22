import { describe, it, expect } from 'vitest';
import { tabsForHost, openTabsLabel } from '../../src/renderer/lib/host-tabs';
import type { TerminalTab } from '../../src/renderer/stores/terminal-store';
import type { SSHSession } from '../../src/shared/types';

const session = (id: string, hostId: string, connected = true): SSHSession => ({
  id,
  hostId,
  label: hostId,
  colour: null,
  connected,
  status: connected ? 'connected' : 'connecting',
  startedAt: '2026-10-22T10:00:00.000Z',
});

const tab = (id: string, sessionId: string | null, type: TerminalTab['type'] = 'terminal'): TerminalTab => ({
  id,
  type,
  label: id,
  colour: null,
  sessionId,
});

describe('tabsForHost', () => {
  const sessions = [session('s1', 'host-a'), session('s2', 'host-b'), session('pending-3', 'host-a', false)];
  const tabs = [tab('t1', 's1'), tab('t2', 's2', 'sftp'), tab('t3', 'pending-3', 'sftp'), tab('t4', null)];

  it('returns the terminal and SFTP tabs whose session belongs to the host, pending ones included', () => {
    expect(tabsForHost(tabs, sessions, 'host-a').map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('leaves other hosts and tabs without a session alone', () => {
    expect(tabsForHost(tabs, sessions, 'host-b').map((t) => t.id)).toEqual(['t2']);
    expect(tabsForHost(tabs, sessions, 'host-c')).toEqual([]);
  });

  it('is empty when nothing is open', () => {
    expect(tabsForHost([], [], 'host-a')).toEqual([]);
  });
});

describe('openTabsLabel', () => {
  it('pluralises', () => {
    expect(openTabsLabel(1)).toBe('1 open tab');
    expect(openTabsLabel(2)).toBe('2 open tabs');
  });
});
