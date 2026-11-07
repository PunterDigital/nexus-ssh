import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconnectLoop, RECONNECT_DELAYS_MS, type ReconnectState } from '../../src/renderer/lib/reconnect';
import { classifyClose, closeMarker, RECONNECTED_MARKER } from '../../src/main/ssh/session-close';

describe('ReconnectLoop (#4322)', () => {
  let states: Array<ReconnectState | null>;
  const last = () => states[states.length - 1];

  beforeEach(() => {
    vi.useFakeTimers();
    states = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const makeLoop = (connect: () => Promise<void>) =>
    new ReconnectLoop({ connect, onChange: (s) => states.push(s), now: () => Date.now() });

  it('waits 1 s, 2 s and 4 s before attempts 1 to 3, then gives up', async () => {
    expect(RECONNECT_DELAYS_MS).toEqual([1_000, 2_000, 4_000]);
    const connect = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const loop = makeLoop(connect);
    loop.start('Connection lost');

    expect(last()).toMatchObject({ phase: 'waiting', attempt: 1, total: 3, error: 'Connection lost' });
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(last()).toMatchObject({ phase: 'waiting', attempt: 2, error: 'ECONNREFUSED' });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(last()).toEqual({ phase: 'failed', total: 3, error: 'ECONNREFUSED' });

    // Gave up: no more attempts on its own.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('reports the countdown target and the attempt under way', async () => {
    let resolve!: () => void;
    const loop = makeLoop(() => new Promise<void>((r) => (resolve = r)));
    const start = Date.now();
    loop.start('lost');
    expect(last()).toMatchObject({ phase: 'waiting', retryAt: start + 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last()).toMatchObject({ phase: 'connecting', attempt: 1 });
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toBeNull();
  });

  it('connects on a later attempt and stops there', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(undefined);
    const loop = makeLoop(connect);
    loop.start('lost');
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(last()).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('"Reconnect now" skips the wait', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const loop = makeLoop(connect);
    loop.start('lost');
    loop.skipWait();
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(last()).toBeNull();
  });

  it('Stop cancels the countdown, and "Try again" starts a fresh round of 3', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('refused'));
    const loop = makeLoop(connect);
    loop.start('lost');
    loop.stop();
    expect(last()).toEqual({ phase: 'stopped', error: 'lost' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(connect).not.toHaveBeenCalled();

    loop.start('lost');
    await vi.advanceTimersByTimeAsync(7_000);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(last()).toMatchObject({ phase: 'failed' });
  });

  it('an attempt under way when Stop is pressed: a failure stays stopped, a success still connects', async () => {
    let reject!: (e: Error) => void;
    const failing = makeLoop(() => new Promise<void>((_r, j) => (reject = j)));
    failing.start('lost');
    await vi.advanceTimersByTimeAsync(1_000);
    failing.stop();
    reject(new Error('host unreachable'));
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ phase: 'stopped', error: 'host unreachable' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(last()).toEqual({ phase: 'stopped', error: 'host unreachable' });

    states = [];
    let resolve!: () => void;
    const succeeding = makeLoop(() => new Promise<void>((r) => (resolve = r)));
    succeeding.start('lost');
    await vi.advanceTimersByTimeAsync(1_000);
    succeeding.stop();
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toBeNull();
  });

  it('never runs two attempts at once after Stop and Try again', async () => {
    let active = 0;
    let maxActive = 0;
    const pending: Array<(e?: Error) => void> = [];
    const loop = makeLoop(
      () =>
        new Promise<void>((resolve, reject) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          pending.push((e) => {
            active -= 1;
            if (e) reject(e);
            else resolve();
          });
        }),
    );
    loop.start('lost');
    await vi.advanceTimersByTimeAsync(1_000);
    loop.stop();
    loop.start('lost');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(active).toBe(1);
    pending[0](new Error('old attempt failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(active).toBe(1);
    expect(maxActive).toBe(1);
    expect(last()).toMatchObject({ phase: 'connecting', attempt: 1 });
  });

  it('reports nothing after dispose', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const loop = makeLoop(connect);
    loop.start('lost');
    const count = states.length;
    loop.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(connect).not.toHaveBeenCalled();
    expect(states).toHaveLength(count);
  });
});

describe('classifyClose / closeMarker (#4322)', () => {
  it('a shell that sent an exit status ended on purpose', () => {
    expect(classifyClose('s1', { exitCode: 0 })).toEqual({ sessionId: 's1', reason: 'exit', exitCode: 0 });
    // Even with a client error after it (the server hangs up once the shell is gone).
    expect(classifyClose('s1', { exitCode: 2, error: 'read ECONNRESET' })).toMatchObject({ reason: 'exit', exitCode: 2 });
  });

  it('anything else is a lost connection, with a reason', () => {
    expect(classifyClose('s1', { error: 'Keepalive timeout' })).toEqual({
      sessionId: 's1',
      reason: 'dropped',
      error: 'Keepalive timeout',
    });
    expect(classifyClose('s1', { exitSignal: 'HUP' })).toMatchObject({
      reason: 'dropped',
      error: 'The remote shell was stopped (HUP)',
    });
    expect(classifyClose('s1', {})).toMatchObject({ reason: 'dropped', error: 'The server closed the connection' });
  });

  it('writes a line the terminal shows', () => {
    expect(closeMarker({ sessionId: 's', reason: 'exit', exitCode: 0 })).toContain('--- Connection closed ---');
    expect(closeMarker({ sessionId: 's', reason: 'exit', exitCode: 3 })).toContain('Connection closed (exit code: 3)');
    expect(closeMarker({ sessionId: 's', reason: 'dropped', error: 'Keepalive timeout' })).toContain(
      '--- Connection lost: Keepalive timeout ---',
    );
    expect(RECONNECTED_MARKER).toContain('--- Reconnected ---');
  });
});
