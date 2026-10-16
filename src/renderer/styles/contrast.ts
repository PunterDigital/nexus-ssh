// ============================================================
// Colour contrast helpers (WCAG 2.2 relative luminance)
// Used by applyTheme() to pick readable text on the accent colour,
// and by tests that audit the bundled themes.
// ============================================================

/** Parses #rgb, #rrggbb or #rrggbbaa (alpha ignored) into 0–255 channels. */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colour for content on top of `background` (e.g. a primary button on the accent colour):
 * whichever of the candidates contrasts most. Candidates default to white and near-black.
 */
export function readableOn(background: string, candidates: string[] = ['#ffffff', '#111111']): string {
  return candidates.reduce((best, c) => (contrastRatio(c, background) > contrastRatio(best, background) ? c : best));
}
