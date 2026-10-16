import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contrastRatio, parseHex, readableOn, relativeLuminance } from '../../src/renderer/styles/contrast';
import { BUNDLED_THEMES } from '../../src/renderer/styles/themes';

describe('contrast helpers', () => {
  it('parses short and long hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#7aa2f7')).toEqual([122, 162, 247]);
    expect(parseHex('#7aa2f726')).toEqual([122, 162, 247]);
    expect(() => parseHex('rgb(0,0,0)')).toThrow();
  });

  it('matches the WCAG reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 on white is the classic "just passes AA" grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('picks the more readable text colour', () => {
    expect(readableOn('#000000')).toBe('#ffffff');
    expect(readableOn('#ffffff')).toBe('#111111');
  });
});

// Primary and danger buttons put text on the theme's accent / danger colour. White text (the old
// .btn-primary) is under 3:1 on every bundled accent, so applyTheme() derives the text colour.
describe.each(BUNDLED_THEMES.map((t) => [t.name, t.ui] as const))('%s', (_name, ui) => {
  it('text on the accent colour meets WCAG AA (4.5:1)', () => {
    expect(contrastRatio(readableOn(ui.accent), ui.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('text on the danger colour meets WCAG AA for large/bold text (3:1)', () => {
    expect(contrastRatio(readableOn(ui.danger), ui.danger)).toBeGreaterThanOrEqual(3);
  });

  it('primary text on every surface meets WCAG AA (4.5:1)', () => {
    for (const bg of [ui.bgPrimary, ui.bgSecondary, ui.bgTertiary]) {
      expect(contrastRatio(ui.textPrimary, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('tokens.css', () => {
  const css = readFileSync(path.resolve(__dirname, '../../src/renderer/styles/tokens.css'), 'utf8');

  it('derives every semantic colour from theme colours (no hex in the inline theme block)', () => {
    const inline = css.match(/@theme inline \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(inline).toContain('--color-surface:');
    expect(inline).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('turns motion off for people who ask for reduced motion', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*--duration-base: 0ms/);
  });
});
