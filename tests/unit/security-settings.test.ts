import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<{ success: boolean; data?: unknown }>;
const handlers = new Map<string, Handler>();
vi.mock('electron', () => ({
  clipboard: { readText: vi.fn(async () => ''), writeText: vi.fn(async () => {}) },
  powerMonitor: { on: vi.fn(), getSystemIdleTime: vi.fn(() => 0) },
  ipcMain: { handle: vi.fn((channel: string, fn: Handler) => handlers.set(channel, fn)), on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

// In-memory app_meta table standing in for the SQLCipher vault.
const meta = new Map<string, string>();
let unlockListener: (() => void) | undefined;
vi.mock('../../src/main/vault', () => ({
  vaultEngine: {
    isUnlocked: () => true,
    lock: vi.fn(),
    onUnlocked: (fn: () => void) => {
      unlockListener = fn;
      return () => {};
    },
    getDb: () => ({
      run: (_sql: string, [key, value]: string[], cb: (err: Error | null) => void) => {
        meta.set(key, value);
        cb(null);
      },
      get: (_sql: string, [key]: string[], cb: (err: Error | null, row?: unknown) => void) => {
        cb(null, meta.has(key) ? { key, value: meta.get(key) } : undefined);
      },
      all: (_sql: string, _params: unknown[], cb: (err: Error | null, rows: unknown[]) => void) => {
        cb(null, [...meta].map(([key, value]) => ({ key, value })));
      },
    }),
  },
}));
vi.mock('../../src/main/ssh', () => ({ sshManager: { destroyAll: vi.fn() } }));
vi.mock('../../src/main/sftp', () => ({ sftpManager: { destroyAll: vi.fn() } }));

const { IPC } = await import('../../src/shared/constants');
const { securityManager } = await import('../../src/main/security');
const { registerSettingsHandlers } = await import('../../src/main/ipc/settings-handlers');
registerSettingsHandlers();

const setAutoLock = vi.spyOn(securityManager, 'setAutoLockTimeout');
const setClipboard = vi.spyOn(securityManager, 'setClipboardClearTimeout');
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('vault security settings reach the security manager', () => {
  beforeEach(() => {
    meta.clear();
    setAutoLock.mockClear();
    setClipboard.mockClear();
  });

  it("applies the vault's saved timeouts when it unlocks", async () => {
    meta.set('setting:autoLockTimeout', '5');
    meta.set('setting:clipboardClearTimeout', '10');
    unlockListener!();
    await flush();
    expect(setAutoLock).toHaveBeenLastCalledWith(5);
    expect(setClipboard).toHaveBeenLastCalledWith(10);
  });

  it('falls back to the defaults for a vault with no saved values', async () => {
    unlockListener!();
    await flush();
    expect(setAutoLock).toHaveBeenLastCalledWith(15);
    expect(setClipboard).toHaveBeenLastCalledWith(30);
  });

  it('applies a changed timeout immediately, including 0 (off)', async () => {
    await handlers.get(IPC.SETTINGS_SET)!({}, 'autoLockTimeout', 0);
    expect(setAutoLock).toHaveBeenLastCalledWith(0);

    await handlers.get(IPC.SETTINGS_SET)!({}, 'clipboardClearTimeout', 45);
    expect(setClipboard).toHaveBeenLastCalledWith(45);
  });

  it('resetting a timeout applies the default', async () => {
    meta.set('setting:autoLockTimeout', '1');
    await handlers.get(IPC.SETTINGS_RESET)!({}, 'autoLockTimeout');
    expect(setAutoLock).toHaveBeenLastCalledWith(15);
  });

  it('ignores unrelated settings', async () => {
    await handlers.get(IPC.SETTINGS_SET)!({}, 'theme', 'light');
    expect(setAutoLock).not.toHaveBeenCalled();
    expect(setClipboard).not.toHaveBeenCalled();
  });
});
