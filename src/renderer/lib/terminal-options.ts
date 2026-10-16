import type { ITerminalOptions } from '@xterm/xterm';
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, DEFAULT_SCROLLBACK } from '../../shared/constants';

// ============================================================
// Settings → Terminal, as xterm.js options (#2662). The vault stores the values the settings
// panel saves; this turns them into options for new terminals and for open ones when they change.
// ============================================================

export type CursorStyle = 'block' | 'underline' | 'bar';

export interface TerminalPrefs {
  terminalFont: string;
  terminalFontSize: number;
  scrollbackLines: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  /** WebGL renderer. Applies to terminals opened after the change. */
  gpuAcceleration: boolean;
}

export const DEFAULT_TERMINAL_PREFS: TerminalPrefs = {
  terminalFont: DEFAULT_FONT,
  terminalFontSize: DEFAULT_FONT_SIZE,
  scrollbackLines: DEFAULT_SCROLLBACK,
  cursorStyle: 'block',
  cursorBlink: true,
  gpuAcceleration: true,
};

/** The settings keys that change a terminal. */
export const TERMINAL_PREF_KEYS = Object.keys(DEFAULT_TERMINAL_PREFS) as Array<keyof TerminalPrefs>;

export function isTerminalPrefKey(key: string): key is keyof TerminalPrefs {
  return (TERMINAL_PREF_KEYS as string[]).includes(key);
}

const CURSOR_STYLES: CursorStyle[] = ['block', 'underline', 'bar'];

// The same limits the settings panel enforces.
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * One saved value, checked: anything missing or of the wrong type falls back to the default,
 * and numbers are clamped to the settings panel's ranges.
 */
export function readTerminalPref<K extends keyof TerminalPrefs>(key: K, value: unknown): TerminalPrefs[K] {
  const fallback = DEFAULT_TERMINAL_PREFS[key];
  switch (key) {
    case 'terminalFont':
      return (typeof value === 'string' && value.trim() ? value.trim() : fallback) as TerminalPrefs[K];
    case 'terminalFontSize':
      return (typeof value === 'number' && Number.isFinite(value)
        ? clamp(Math.round(value), 8, 32)
        : fallback) as TerminalPrefs[K];
    case 'scrollbackLines':
      return (typeof value === 'number' && Number.isFinite(value)
        ? clamp(Math.round(value), 1000, 100000)
        : fallback) as TerminalPrefs[K];
    case 'cursorStyle':
      return (CURSOR_STYLES.includes(value as CursorStyle) ? value : fallback) as TerminalPrefs[K];
    default:
      return (typeof value === 'boolean' ? value : fallback) as TerminalPrefs[K];
  }
}

/** All terminal settings from a settings:get-all result (or any partial record). */
export function readTerminalPrefs(raw: Record<string, unknown> | null | undefined): TerminalPrefs {
  const prefs = { ...DEFAULT_TERMINAL_PREFS };
  for (const key of TERMINAL_PREF_KEYS) {
    (prefs as Record<string, unknown>)[key] = readTerminalPref(key, raw?.[key]);
  }
  return prefs;
}

/** The chosen font first, then monospace fonts most systems have. */
export function fontStack(font: string): string {
  const fallbacks = ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', 'Consolas'].filter(
    (f) => f !== font,
  );
  const quote = (f: string) => `'${f.replace(/'/g, '')}'`;
  return [font === 'monospace' ? font : quote(font), ...fallbacks.map(quote), 'monospace'].join(', ');
}

export function toXtermOptions(
  prefs: TerminalPrefs,
): Pick<ITerminalOptions, 'fontFamily' | 'fontSize' | 'scrollback' | 'cursorStyle' | 'cursorBlink'> {
  return {
    fontFamily: fontStack(prefs.terminalFont),
    fontSize: prefs.terminalFontSize,
    scrollback: prefs.scrollbackLines,
    cursorStyle: prefs.cursorStyle,
    cursorBlink: prefs.cursorBlink,
  };
}

// The last settings read, so a new terminal starts with them instead of the defaults while it
// asks main for the current values. Reset on lock (another vault may be unlocked next).
let cached: TerminalPrefs | null = null;

export function cachedTerminalPrefs(): TerminalPrefs {
  return cached ?? DEFAULT_TERMINAL_PREFS;
}

export function setCachedTerminalPrefs(prefs: TerminalPrefs | null): void {
  cached = prefs;
}
