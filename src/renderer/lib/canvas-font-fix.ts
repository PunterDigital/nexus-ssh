// ============================================================
// #5004: xterm's WebGL renderer drew tiny glyphs in full-size cells on Electron 45.
//
// @xterm/addon-webgl 0.19 (and 0.20 betas) builds its glyph font as
// `${italic} ${weight} ${size}px ${family}`, which starts with a space when the text isn't
// italic (" normal 14px 'JetBrains Mono', …"). Electron 45's Chromium refuses a canvas font
// with leading whitespace and keeps the default "10px sans-serif", so every glyph in the
// atlas came out at 10 px while the cells were measured at the real size. Trimming the value
// before it reaches the canvas restores the real font. Harmless for every other caller: a
// valid font string never starts or ends with whitespace that matters.
//
// Remove once xterm builds the string without the leading space (check the addon's
// `_tmpCtx.font=` and `_getFont` after a bump; tests/e2e/terminal-webgl.spec.ts covers it).
// ============================================================

type FontContextPrototype = { font: string };

const PATCHED = Symbol.for('nexus.canvasFontTrim');

/** Make `proto.font = value` trim surrounding whitespace first. Safe to call more than once. */
export function trimCanvasFontSetter(proto: FontContextPrototype): boolean {
  const target = proto as FontContextPrototype & { [PATCHED]?: boolean };
  if (target[PATCHED]) return false;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!descriptor?.set || !descriptor.get) return false;
  const { get, set } = descriptor;
  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get,
    set(this: unknown, value: unknown) {
      set.call(this, typeof value === 'string' ? value.trim() : value);
    },
  });
  Object.defineProperty(target, PATCHED, { value: true });
  return true;
}

/** Apply to both 2D context types the WebGL addon draws its glyph atlas with. */
export function installCanvasFontFix(): void {
  if (typeof CanvasRenderingContext2D !== 'undefined') trimCanvasFontSetter(CanvasRenderingContext2D.prototype);
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    trimCanvasFontSetter(OffscreenCanvasRenderingContext2D.prototype);
  }
}
