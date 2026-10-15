import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  Updater,
  compareVersions,
  fetchLatestReleaseVersion,
  resolveUpdateMode,
  scheduleUpdateChecks,
  type InstallUpdater,
  type UpdaterDeps,
} from '../../src/main/updater/core';
import type { UpdateStatus } from '../../src/shared/types';

describe('compareVersions', () => {
  it('orders semver numerically, not as strings', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('ignores a leading v', () => {
    expect(compareVersions('v0.1.5', '0.1.4')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });
  it('treats a pre-release as older than the release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
  });
});

describe('resolveUpdateMode', () => {
  const base = {
    platform: 'win32' as NodeJS.Platform,
    isPackaged: true,
    isolatedProfile: false,
    disabledByEnv: false,
  };
  it('installs on packaged Windows builds', () => {
    expect(resolveUpdateMode(base)).toBe('install');
  });
  it('only notifies on macOS (unsigned apps cannot self-update)', () => {
    expect(resolveUpdateMode({ ...base, platform: 'darwin' })).toBe('notify');
  });
  it('is off in dev builds', () => {
    expect(resolveUpdateMode({ ...base, isPackaged: false })).toBe('off');
  });
  it('is off with a test profile, so packaged E2E runs never reach GitHub', () => {
    expect(resolveUpdateMode({ ...base, isolatedProfile: true })).toBe('off');
  });
  it('can be allowed in a test profile for a manual check of a packaged build', () => {
    expect(resolveUpdateMode({ ...base, isolatedProfile: true, allowInTestProfile: true })).toBe('install');
    expect(
      resolveUpdateMode({ ...base, isPackaged: false, isolatedProfile: true, allowInTestProfile: true }),
    ).toBe('off');
  });
  it('is off when disabled by env, even with a test feed', () => {
    expect(resolveUpdateMode({ ...base, disabledByEnv: true, testFeedUrl: 'http://x' })).toBe('off');
  });
  it('uses notify mode against a test feed, even in dev', () => {
    expect(
      resolveUpdateMode({ ...base, isPackaged: false, isolatedProfile: true, testFeedUrl: 'http://x' }),
    ).toBe('notify');
  });
});

/** A stand-in for electron-updater's autoUpdater that emits what the real one would. */
class FakeInstaller extends EventEmitter implements InstallUpdater {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  quitAndInstall = vi.fn();
  next: 'update' | 'none' | 'error' = 'update';
  checks = 0;
  async checkForUpdates(): Promise<unknown> {
    this.checks++;
    if (this.next === 'error') {
      this.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    }
    if (this.next === 'none') {
      this.emit('update-not-available', { version: '0.1.4' });
      return null;
    }
    this.emit('update-available', { version: '0.2.0' });
    // electron-updater keeps downloading after checkForUpdates() resolves
    setTimeout(() => this.emit('update-downloaded', { version: '0.2.0' }), 0);
    return null;
  }
}

function makeUpdater(overrides: Partial<UpdaterDeps> = {}) {
  const sent: UpdateStatus[] = [];
  const logs: string[] = [];
  const installer = new FakeInstaller();
  const deps: UpdaterDeps = {
    mode: 'install',
    currentVersion: '0.1.4',
    loadInstaller: vi.fn(async () => installer),
    fetchLatestVersion: vi.fn(async () => '0.2.0'),
    send: (s) => sent.push(s),
    log: (m) => logs.push(m),
    ...overrides,
  };
  return { updater: new Updater(deps), deps, installer, sent, logs };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('Updater: install mode (Windows)', () => {
  it('downloads in the background and never installs on quit without a click', async () => {
    const { updater, installer, sent } = makeUpdater();
    const status = await updater.check();
    expect(installer.autoDownload).toBe(true);
    expect(installer.autoInstallOnAppQuit).toBe(false);
    expect(status).toEqual({ state: 'available', mode: 'install', version: '0.2.0' });
    await tick();
    expect(updater.getStatus()).toEqual({ state: 'downloaded', mode: 'install', version: '0.2.0' });
    expect(sent.map((s) => s.state)).toEqual(['checking', 'available', 'downloaded']);
    expect(installer.quitAndInstall).not.toHaveBeenCalled();
  });

  it('restarts into the update only when asked, silently and relaunching', async () => {
    const { updater, installer } = makeUpdater();
    expect(() => updater.install()).toThrow(/No update/);
    await updater.check();
    expect(() => updater.install()).toThrow(/No update/); // still downloading
    await tick();
    updater.install();
    expect(installer.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('reports up to date', async () => {
    const { updater, installer } = makeUpdater();
    installer.next = 'none';
    expect(await updater.check()).toEqual({ state: 'up-to-date', mode: 'install' });
  });

  it('turns failures into an error status and a log line, never a throw', async () => {
    const { updater, installer, logs } = makeUpdater();
    installer.next = 'error';
    const status = await updater.check();
    expect(status.state).toBe('error');
    expect(logs.join('\n')).toMatch(/ERR_INTERNET_DISCONNECTED/);
  });

  it('keeps a downloaded update when a later check fails', async () => {
    const { updater, installer } = makeUpdater();
    await updater.check();
    await tick();
    installer.next = 'error';
    installer.emit('error', new Error('later failure'));
    expect(updater.getStatus().state).toBe('downloaded');
    // and does not check again once downloaded
    await updater.check();
    expect(installer.checks).toBe(1);
  });

  it('loads electron-updater once and shares concurrent checks', async () => {
    const { updater, deps, installer } = makeUpdater();
    installer.next = 'none';
    await Promise.all([updater.check(), updater.check()]);
    await updater.check();
    expect(deps.loadInstaller).toHaveBeenCalledTimes(1);
    expect(installer.checks).toBe(2);
  });
});

describe('Updater: notify mode (macOS)', () => {
  it('reports a newer release without loading electron-updater', async () => {
    const { updater, deps } = makeUpdater({ mode: 'notify' });
    expect(await updater.check()).toEqual({ state: 'available', mode: 'notify', version: '0.2.0' });
    expect(deps.loadInstaller).not.toHaveBeenCalled();
    expect(() => updater.install()).toThrow();
  });
  it('is up to date when the release is the same or older', async () => {
    const { updater } = makeUpdater({ mode: 'notify', fetchLatestVersion: async () => '0.1.4' });
    expect((await updater.check()).state).toBe('up-to-date');
  });
  it('turns a failed lookup into an error status', async () => {
    const { updater } = makeUpdater({
      mode: 'notify',
      fetchLatestVersion: async () => {
        throw new Error('HTTP 503');
      },
    });
    expect(await updater.check()).toMatchObject({ state: 'error', message: 'HTTP 503' });
  });
});

describe('Updater: off', () => {
  it('never checks', async () => {
    const { updater, deps, sent } = makeUpdater({ mode: 'off' });
    expect(await updater.check()).toEqual({ state: 'idle', mode: 'off' });
    expect(deps.loadInstaller).not.toHaveBeenCalled();
    expect(deps.fetchLatestVersion).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

describe('scheduleUpdateChecks', () => {
  function fakeTimers() {
    const timeouts: Array<{ fn: () => void; ms: number }> = [];
    const intervals: Array<{ fn: () => void; ms: number }> = [];
    return {
      timeouts,
      intervals,
      timers: {
        setTimeout: (fn: () => void, ms: number) => timeouts.push({ fn, ms }),
        setInterval: (fn: () => void, ms: number) => intervals.push({ fn, ms }),
      },
    };
  }

  it('checks after the first delay, then on the interval, honouring the setting each time', async () => {
    const check = vi.fn(async () => ({ state: 'up-to-date', mode: 'notify' }) as UpdateStatus);
    let enabled = true;
    const t = fakeTimers();
    scheduleUpdateChecks({
      updater: { check, mode: 'notify' },
      isEnabled: async () => enabled,
      firstDelayMs: 5000,
      intervalMs: 60_000,
      timers: t.timers,
    });
    expect(check).not.toHaveBeenCalled(); // never during startup
    expect(t.timeouts[0].ms).toBe(5000);
    t.timeouts[0].fn();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
    expect(t.intervals[0].ms).toBe(60_000);
    enabled = false;
    t.intervals[0].fn();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
    enabled = true;
    t.intervals[0].fn();
    await tick();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('schedules nothing when updates are off', () => {
    const t = fakeTimers();
    scheduleUpdateChecks({
      updater: { check: vi.fn(), mode: 'off' },
      isEnabled: async () => true,
      firstDelayMs: 1,
      intervalMs: 1,
      timers: t.timers,
    });
    expect(t.timeouts).toEqual([]);
  });
});

describe('fetchLatestReleaseVersion', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('reads tag_name without the v', async () => {
    expect(await fetchLatestReleaseVersion('u', 'ua', respond(200, { tag_name: 'v0.1.5' }))).toBe('0.1.5');
  });
  it('rejects HTTP errors and missing versions', async () => {
    await expect(fetchLatestReleaseVersion('u', 'ua', respond(403, {}))).rejects.toThrow(/403/);
    await expect(
      fetchLatestReleaseVersion('u', 'ua', respond(200, { tag_name: 'nightly' })),
    ).rejects.toThrow(/no version/);
  });
});
