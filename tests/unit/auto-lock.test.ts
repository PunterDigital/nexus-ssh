import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let idleSeconds = 0;
let unlocked = true;
const send = vi.fn();
vi.mock('electron', () => ({
  clipboard: { readText: vi.fn(async () => ''), writeText: vi.fn(async () => {}) },
  powerMonitor: { on: vi.fn(), getSystemIdleTime: vi.fn(() => idleSeconds) },
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn() },
}));
// Keep the native SQLCipher module and real connections out of this test.
vi.mock('../../src/main/vault', () => ({
  vaultEngine: {
    isUnlocked: () => unlocked,
    lock: vi.fn(() => {
      unlocked = false;
    }),
  },
}));
vi.mock('../../src/main/ssh', () => ({ sshManager: { destroyAll: vi.fn() } }));
vi.mock('../../src/main/sftp', () => ({ sftpManager: { destroyAll: vi.fn() } }));

const { securityManager, shouldIdleLock } = await import('../../src/main/security');
const { sshManager } = await import('../../src/main/ssh');
const { sftpManager } = await import('../../src/main/sftp');

describe('shouldIdleLock', () => {
  it('locks once idle time reaches the timeout', () => {
    expect(shouldIdleLock(899, 15)).toBe(false);
    expect(shouldIdleLock(900, 15)).toBe(true);
    expect(shouldIdleLock(5000, 15)).toBe(true);
  });

  it('never locks when the timeout is 0 (disabled)', () => {
    expect(shouldIdleLock(1_000_000, 0)).toBe(false);
  });
});

describe('idle auto-lock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    idleSeconds = 0;
    unlocked = true;
    send.mockClear();
    securityManager.setMainWindow({ isDestroyed: () => false, webContents: { send } } as never);
    securityManager.setAutoLockTimeout(15);
  });
  afterEach(() => {
    securityManager.stopIdleMonitoring();
    delete process.env.NEXUS_DISABLE_IDLE_LOCK;
    vi.useRealTimers();
  });

  it('locks the vault, drops sessions and tells the renderer when idle past the timeout', () => {
    securityManager.init();
    idleSeconds = 14 * 60;
    vi.advanceTimersByTime(30_000);
    expect(send).not.toHaveBeenCalled();

    idleSeconds = 15 * 60;
    vi.advanceTimersByTime(30_000);
    expect(unlocked).toBe(false);
    expect(sshManager.destroyAll).toHaveBeenCalled();
    expect(sftpManager.destroyAll).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('security:vault-locked');
  });

  it('does not poll idle time when NEXUS_DISABLE_IDLE_LOCK=1', () => {
    process.env.NEXUS_DISABLE_IDLE_LOCK = '1';
    securityManager.init();
    idleSeconds = 60 * 60;
    vi.advanceTimersByTime(120_000);
    expect(unlocked).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});
