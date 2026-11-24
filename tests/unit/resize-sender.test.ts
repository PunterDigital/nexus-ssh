import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResizeSender, RESIZE_INTERVAL_MS } from '../../src/renderer/lib/resize-sender';

// #5663: dragging the window sent one ssh:resize per animation frame.

describe('createResizeSender', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends at most one resize per 100 ms while a drag fires every frame, and ends on the final size', () => {
    const sent: Array<[number, number]> = [];
    const sender = createResizeSender((c, r) => sent.push([c, r]));
    // 1 s of dragging at 60 fps, a new size every frame.
    for (let frame = 0; frame < 60; frame++) {
      sender.request(80 + frame, 24 + (frame >> 2));
      vi.advanceTimersByTime(1000 / 60);
    }
    vi.advanceTimersByTime(RESIZE_INTERVAL_MS);
    expect(RESIZE_INTERVAL_MS).toBe(100);
    expect(sent.length).toBeLessThanOrEqual(11);
    expect(sent.length).toBeGreaterThanOrEqual(9);
    expect(sent[0]).toEqual([80, 24]);
    expect(sent.at(-1)).toEqual([139, 38]);
  });

  it('sends a single change at once', () => {
    const send = vi.fn();
    const sender = createResizeSender(send);
    sender.request(100, 30);
    expect(send).toHaveBeenCalledWith(100, 30);
  });

  it('drops a size equal to the last one sent, and invalid sizes', () => {
    const send = vi.fn();
    const sender = createResizeSender(send);
    sender.flush(100, 30);
    sender.flush(100, 30);
    vi.advanceTimersByTime(500);
    sender.request(100, 30);
    sender.request(0, 30);
    sender.request(Number.NaN, 30);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flush sends now and cancels a pending size', () => {
    const send = vi.fn();
    const sender = createResizeSender(send);
    sender.request(90, 30);
    sender.request(91, 30); // pending
    sender.flush(120, 40);
    vi.advanceTimersByTime(500);
    expect(send.mock.calls).toEqual([
      [90, 30],
      [120, 40],
    ]);
  });

  it('sends nothing after dispose', () => {
    const send = vi.fn();
    const sender = createResizeSender(send);
    sender.request(90, 30);
    sender.request(91, 30);
    sender.dispose();
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
