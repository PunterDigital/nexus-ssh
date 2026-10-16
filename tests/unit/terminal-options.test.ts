import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_PREFS,
  fontStack,
  isTerminalPrefKey,
  readTerminalPref,
  readTerminalPrefs,
  toXtermOptions,
} from '../../src/renderer/lib/terminal-options';

// #2662: Settings → Terminal values become xterm options.
describe('terminal options', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(readTerminalPrefs(null)).toEqual(DEFAULT_TERMINAL_PREFS);
    expect(readTerminalPrefs({})).toEqual(DEFAULT_TERMINAL_PREFS);
  });

  it('reads saved values', () => {
    const prefs = readTerminalPrefs({
      terminalFont: 'Fira Code',
      terminalFontSize: 18,
      scrollbackLines: 5000,
      cursorStyle: 'bar',
      cursorBlink: false,
      gpuAcceleration: false,
      autoLockTimeout: 15, // not a terminal setting: ignored
    });
    expect(prefs).toEqual({
      terminalFont: 'Fira Code',
      terminalFontSize: 18,
      scrollbackLines: 5000,
      cursorStyle: 'bar',
      cursorBlink: false,
      gpuAcceleration: false,
    });
    expect(toXtermOptions(prefs)).toEqual({
      fontFamily: fontStack('Fira Code'),
      fontSize: 18,
      scrollback: 5000,
      cursorStyle: 'bar',
      cursorBlink: false,
    });
  });

  it('falls back or clamps when a stored value is wrong', () => {
    expect(readTerminalPref('cursorStyle', 'beam')).toBe('block');
    expect(readTerminalPref('cursorBlink', 'false')).toBe(true);
    expect(readTerminalPref('terminalFontSize', 99)).toBe(32);
    expect(readTerminalPref('terminalFontSize', 2)).toBe(8);
    expect(readTerminalPref('terminalFontSize', Number.NaN)).toBe(14);
    expect(readTerminalPref('scrollbackLines', 10)).toBe(1000);
    expect(readTerminalPref('scrollbackLines', 1e9)).toBe(100000);
    expect(readTerminalPref('terminalFont', '  ')).toBe('JetBrains Mono');
  });

  it('puts the chosen font first, quoted, with monospace fallbacks', () => {
    expect(fontStack('Fira Code')).toBe("'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Menlo', 'Consolas', monospace");
    expect(fontStack('monospace').startsWith('monospace, ')).toBe(true);
    expect(fontStack("Evil', serif")).toMatch(/^'Evil, serif', /);
  });

  it('knows which settings keys change a terminal', () => {
    expect(isTerminalPrefKey('cursorStyle')).toBe(true);
    expect(isTerminalPrefKey('gpuAcceleration')).toBe(true);
    expect(isTerminalPrefKey('theme')).toBe(false);
  });
});
