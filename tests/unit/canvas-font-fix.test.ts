import { describe, expect, it } from 'vitest';
import { trimCanvasFontSetter } from '../../src/renderer/lib/canvas-font-fix';

// A stand-in for CanvasRenderingContext2D.prototype that behaves like Electron 45's Chromium:
// a font with leading whitespace is refused and the old value stays (#5004).
function makeContextClass() {
  class FakeContext {
    private _font = '10px sans-serif';
  }
  Object.defineProperty(FakeContext.prototype, 'font', {
    configurable: true,
    enumerable: true,
    get(this: { _font: string }) {
      return this._font;
    },
    set(this: { _font: string }, value: string) {
      if (/^\s/.test(value)) return; // refused, like Chromium
      this._font = value;
    },
  });
  return FakeContext as unknown as { new (): { font: string }; prototype: { font: string } };
}

describe('trimCanvasFontSetter (#5004)', () => {
  it('reproduces the refusal without the fix', () => {
    const Ctx = makeContextClass();
    const ctx = new Ctx();
    ctx.font = " normal 14px 'JetBrains Mono', monospace";
    expect(ctx.font).toBe('10px sans-serif');
  });

  it("lets the WebGL addon's leading-space font through", () => {
    const Ctx = makeContextClass();
    expect(trimCanvasFontSetter(Ctx.prototype)).toBe(true);
    const ctx = new Ctx();
    ctx.font = " normal 24px 'JetBrains Mono', monospace";
    expect(ctx.font).toBe("normal 24px 'JetBrains Mono', monospace");
    ctx.font = 'italic bold 12px Consolas ';
    expect(ctx.font).toBe('italic bold 12px Consolas');
  });

  it('leaves ordinary fonts alone and installs only once', () => {
    const Ctx = makeContextClass();
    trimCanvasFontSetter(Ctx.prototype);
    expect(trimCanvasFontSetter(Ctx.prototype)).toBe(false);
    const ctx = new Ctx();
    ctx.font = '14px monospace';
    expect(ctx.font).toBe('14px monospace');
  });
});
