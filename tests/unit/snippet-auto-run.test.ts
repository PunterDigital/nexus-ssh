import { describe, it, expect } from 'vitest';
import { planAutoRun, skippedMessage } from '../../src/renderer/lib/snippet-auto-run';
import type { Snippet } from '../../src/shared/types';

// "Run on connect" snippets (#2673): what gets typed into a terminal that just connected.
const context = { hostname: 'web-01.example.com', username: 'deploy', port: 2222 };

function snippet(name: string, command: string, runOnConnect = true): Snippet {
  return {
    id: name,
    vault_id: 'v',
    name,
    command,
    description: null,
    run_on_connect: runOnConnect,
    sort_order: 0,
    created_at: '',
    updated_at: '',
  };
}

describe('planAutoRun', () => {
  it('runs only "Run on connect" snippets, in name order, one line per Enter', () => {
    const plan = planAutoRun(
      [
        snippet('zeta', 'uptime'),
        snippet('manual', 'rm -rf /tmp/x', false),
        snippet('Alpha', 'cd /srv\nls'),
        snippet('beta', 'whoami\r\nid'),
      ],
      context,
    );
    expect(plan.ran).toEqual(['Alpha', 'beta', 'zeta']);
    expect(plan.lines).toEqual(['cd /srv', 'ls', 'whoami', 'id', 'uptime']);
    expect(plan.skipped).toEqual([]);
  });

  it('fills built-ins from the session', () => {
    const plan = planAutoRun([snippet('hi', 'echo {{username}}@{{hostname}}:{{port}}')], context);
    expect(plan.lines).toEqual(['echo deploy@web-01.example.com:2222']);
  });

  it('defaults the port to 22 like the run dialog', () => {
    const plan = planAutoRun([snippet('p', 'echo {{port}}')], { hostname: 'h', username: 'u' });
    expect(plan.lines).toEqual(['echo 22']);
  });

  it('skips snippets that need a value nobody can type: custom, unknown or unfilled built-ins', () => {
    const plan = planAutoRun(
      [
        snippet('custom', 'git checkout {{custom:Branch}}'),
        snippet('unknown', 'echo {{foo}}'),
        snippet('no user', 'echo {{username}}'),
        snippet('fine', 'echo ok'),
      ],
      { hostname: 'h' },
    );
    expect(plan.ran).toEqual(['fine']);
    expect(plan.lines).toEqual(['echo ok']);
    expect(plan.skipped).toEqual(['custom', 'no user', 'unknown']);
  });

  it('types nothing when no snippet runs on connect', () => {
    expect(planAutoRun([snippet('a', 'ls', false)], context)).toEqual({ lines: [], ran: [], skipped: [] });
    expect(planAutoRun([], context)).toEqual({ lines: [], ran: [], skipped: [] });
  });
});

describe('skippedMessage', () => {
  it('is null when nothing was skipped', () => {
    expect(skippedMessage([], 'Web')).toBeNull();
  });

  it('names each skipped snippet and the host', () => {
    expect(skippedMessage(['Deploy'], 'Web')).toBe(
      `Didn't auto-run "Deploy" on Web: needs a value to type in. Run it from Snippets.`,
    );
    expect(skippedMessage(['A', 'B'], 'Web')).toBe(
      `Didn't auto-run "A", "B" on Web: need values to type in. Run them from Snippets.`,
    );
  });
});
