import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MAIN_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_KEY_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  clampSidebarWidth,
  effectiveSidebarWidth,
  sidebarWidthForKey,
} from '../../src/renderer/components/shell/layout';

describe('app shell layout (#2365)', () => {
  it('clamps stored sidebar widths and falls back to the default for junk', () => {
    expect(clampSidebarWidth(250)).toBe(250);
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(200.6)).toBe(201);
    expect(clampSidebarWidth('300')).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('never lets the sidebar squeeze the main area below its minimum', () => {
    // Plenty of room: the user's width
    expect(effectiveSidebarWidth(SIDEBAR_MAX_WIDTH, 1920)).toBe(SIDEBAR_MAX_WIDTH);
    // Minimum window with a maximum-width sidebar: the main area keeps MAIN_MIN_WIDTH
    const atMin = effectiveSidebarWidth(SIDEBAR_MAX_WIDTH, WINDOW_MIN_WIDTH);
    expect(WINDOW_MIN_WIDTH - atMin).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH);
    expect(atMin).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
    // Even narrower than designed for: still at least the sidebar minimum
    expect(effectiveSidebarWidth(300, 500)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('resizes with the arrow keys, Home and End', () => {
    expect(sidebarWidthForKey(224, 'ArrowRight', false)).toBe(224 + SIDEBAR_KEY_STEP);
    expect(sidebarWidthForKey(224, 'ArrowLeft', false)).toBe(224 - SIDEBAR_KEY_STEP);
    expect(sidebarWidthForKey(224, 'ArrowRight', true)).toBe(224 + SIDEBAR_KEY_STEP * 4);
    expect(sidebarWidthForKey(SIDEBAR_MIN_WIDTH, 'ArrowLeft', true)).toBe(
      SIDEBAR_MIN_WIDTH
    );
    expect(sidebarWidthForKey(224, 'Home', false)).toBe(SIDEBAR_MIN_WIDTH);
    expect(sidebarWidthForKey(224, 'End', false)).toBe(SIDEBAR_MAX_WIDTH);
    expect(sidebarWidthForKey(224, 'Enter', false)).toBeNull();
  });

  it('matches the BrowserWindow minimum size in the main process', () => {
    const main = readFileSync(path.resolve(__dirname, '../../src/main/index.ts'), 'utf8');
    expect(main).toMatch(new RegExp(`minWidth:\\s*${WINDOW_MIN_WIDTH}\\b`));
    expect(main).toMatch(new RegExp(`minHeight:\\s*${WINDOW_MIN_HEIGHT}\\b`));
  });
});
