import { describe, expect, it } from 'vitest';
import { revealRow, visibleRows } from '../../src/renderer/lib/virtual-rows';

const g = { rowHeight: 28, overscan: 8, padTop: 2 };

describe('visibleRows', () => {
  it('renders the rows in view plus the overscan, never past the ends', () => {
    expect(visibleRows(0, 560, 10_000, g)).toEqual({ start: 0, end: 28 });
    // 560 px = 20 rows; scrolled to row 1000
    const w = visibleRows(2 + 1000 * 28, 560, 10_000, g);
    expect(w).toEqual({ start: 992, end: 1028 });
    expect(w.end - w.start).toBeLessThanOrEqual(60);
    expect(visibleRows(2 + 9_990 * 28, 560, 10_000, g).end).toBe(10_000);
  });

  it('handles short and empty lists', () => {
    expect(visibleRows(0, 560, 3, g)).toEqual({ start: 0, end: 3 });
    expect(visibleRows(0, 560, 0, g)).toEqual({ start: 0, end: 0 });
    // A list shorter than a stale scroll position still renders its last rows.
    expect(visibleRows(50_000, 560, 3, g)).toEqual({ start: 2, end: 3 });
  });
});

describe('revealRow', () => {
  it('scrolls just enough to show a row above or below the viewport', () => {
    expect(revealRow(10, 1000, 560, g)).toBe(2 + 10 * 28);
    expect(revealRow(100, 0, 560, g)).toBe(2 + 101 * 28 - 560);
    expect(revealRow(5, 0, 560, g)).toBe(0); // already in view
  });
});
