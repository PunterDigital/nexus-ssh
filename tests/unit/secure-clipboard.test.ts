import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Electron 44's main-process clipboard is async; model it that way.
let clipboardText = '';
vi.mock('electron', () => ({
  clipboard: {
    readText: vi.fn(async () => clipboardText),
    writeText: vi.fn(async (t: string) => {
      clipboardText = t;
    }),
  },
  powerMonitor: { on: vi.fn(), getSystemIdleTime: vi.fn(() => 0) },
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn() },
}));
// Keep the native SQLCipher module out of this test.
vi.mock('../../src/main/vault', () => ({ vaultEngine: { isUnlocked: () => false, lock: vi.fn() } }));

const { securityManager } = await import('../../src/main/security');

describe('secure clipboard auto-clear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboardText = '';
    securityManager.setClipboardClearTimeout(30);
  });
  afterEach(() => {
    securityManager.clearClipboardTimer();
    vi.useRealTimers();
  });

  it('clears a copied secret after the timeout', async () => {
    await securityManager.copyToClipboardSecure('s3cret');
    expect(clipboardText).toBe('s3cret');

    await vi.advanceTimersByTimeAsync(29_000);
    expect(clipboardText).toBe('s3cret');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clipboardText).toBe('');
  });

  it('leaves the clipboard alone if the user copied something else', async () => {
    await securityManager.copyToClipboardSecure('s3cret');
    clipboardText = 'something the user copied';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clipboardText).toBe('something the user copied');
  });
});
