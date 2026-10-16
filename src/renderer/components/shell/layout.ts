// App shell layout rules (#2365). Pure functions so they can be unit-tested without a DOM.

/** Sidebar width limits in px. The rail (collapsed sidebar) is 48 px (w-12). */
export const SIDEBAR_MIN_WIDTH = 176;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 224;
/** Keyboard resize step (arrow keys on the resize handle); Shift moves 4x as far. */
export const SIDEBAR_KEY_STEP = 16;
/** The main area always keeps at least this much width, so a wide sidebar can't squeeze it. */
export const MAIN_MIN_WIDTH = 560;

/** The minimum window size (src/main/index.ts must match). Layout is tested from here up. */
export const WINDOW_MIN_WIDTH = 900;
export const WINDOW_MIN_HEIGHT = 600;

/** Clamp a stored or dragged sidebar width to the limits. Non-numbers fall back to the default. */
export function clampSidebarWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

/**
 * The width the sidebar is actually drawn at in a window this wide: the user's width, but
 * never so wide that the main area drops below MAIN_MIN_WIDTH (and never below the minimum).
 */
export function effectiveSidebarWidth(width: number, windowWidth: number): number {
  const room = windowWidth - MAIN_MIN_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(clampSidebarWidth(width), room));
}

/** New width after a resize-handle key press, or null if the key doesn't resize. */
export function sidebarWidthForKey(
  width: number,
  key: string,
  shift: boolean
): number | null {
  const step = shift ? SIDEBAR_KEY_STEP * 4 : SIDEBAR_KEY_STEP;
  switch (key) {
    case 'ArrowLeft':
      return clampSidebarWidth(width - step);
    case 'ArrowRight':
      return clampSidebarWidth(width + step);
    case 'Home':
      return SIDEBAR_MIN_WIDTH;
    case 'End':
      return SIDEBAR_MAX_WIDTH;
    default:
      return null;
  }
}
