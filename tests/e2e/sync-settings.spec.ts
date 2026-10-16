import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Settings → Vault Sync (#2367): configure the local-folder backend, change the schedule, and
// the settings survive leaving the view and restarting the app; a push lands in the folder and
// shows in the history. Then the form fits the minimum window (900 x 600) and a 4K one for
// every backend. Isolated profile and a temp folder as the "backend", never real data.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-syncset-'));
const syncDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-syncset-remote-'));
const syncDir2 = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-syncset-remote2-'));
const PASSWORD = 'e2e-Sync-Settings-31!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

// The layout test reuses the first test's (unlocked) app.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication | undefined;
let page: Page;

test.afterAll(async () => {
  await app?.close().catch(() => {});
  for (const dir of [userDataDir, syncDir, syncDir2]) rmSync(dir, { recursive: true, force: true });
});

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    ...(executablePath
      ? { executablePath, args: [] }
      : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
}

/** Header Settings button → the Vault Sync section (a tab, or a nav button in older layouts). */
async function openVaultSync(p: Page): Promise<void> {
  await p.locator('header').getByRole('button', { name: 'Settings', exact: true }).click();
  const section = p
    .getByRole('tab', { name: 'Vault Sync', exact: true })
    .or(p.getByRole('button', { name: 'Vault Sync', exact: true }));
  await section.first().click();
  await expect(p.getByRole('combobox', { name: 'Backend' })).toBeVisible();
}

/** Leave Settings for the Hosts view, which unmounts the sync settings. */
async function leaveSettings(p: Page): Promise<void> {
  await p.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Hosts', exact: true }).click();
  await expect(p.getByRole('combobox', { name: 'Backend' })).toHaveCount(0);
}

const syncControls = (p: Page) => ({
  backend: p.getByRole('combobox', { name: 'Backend' }),
  directory: p.getByRole('textbox', { name: 'Directory path' }),
  interval: p.getByRole('combobox', { name: 'Sync interval' }),
  onLock: p.getByRole('switch', { name: 'Sync on vault lock' }),
  onLaunch: p.getByRole('switch', { name: 'Sync on app launch' }),
  keepRemote: p.getByRole('radio', { name: /^Always keep remote/ }),
});

async function expectSavedSettings(p: Page): Promise<void> {
  const c = syncControls(p);
  await expect(c.backend).toHaveValue('filesystem');
  await expect(c.directory).toHaveValue(syncDir);
  await expect(c.interval).toHaveValue('900');
  await expect(c.onLock).toHaveAttribute('aria-checked', 'true');
  await expect(c.onLaunch).toHaveAttribute('aria-checked', 'false');
  await expect(c.keepRemote).toBeChecked();
}

test('sync settings: configure a folder backend, settings persist, push shows in history', async () => {
  app = await launch();
  page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Sync Settings');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await openVaultSync(page);
  const c = syncControls(page);

  // Defaults
  await expect(c.backend).toHaveValue('sftp');
  await expect(c.interval).toHaveValue('300');
  await expect(c.onLock).toHaveAttribute('aria-checked', 'true');
  await expect(c.onLaunch).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /^Ask every time/ })).toBeChecked();
  await expect(page.getByText('No syncs yet')).toBeVisible();

  // Local folder backend, pointed at a temp dir
  await c.backend.selectOption('filesystem');
  await expect(page.getByText('Sync to a local or network-mounted directory.')).toBeVisible();
  await c.directory.fill(syncDir);

  // Schedule: every 15 minutes, no sync at launch, remote wins conflicts
  await c.interval.selectOption({ label: 'Every 15 minutes' });
  await c.onLaunch.click();
  await expect(c.onLaunch).toHaveAttribute('aria-checked', 'false');
  // The label toggles the switch too
  await page.getByText('Sync on vault lock', { exact: true }).click();
  await expect(c.onLock).toHaveAttribute('aria-checked', 'false');
  await c.onLock.press('Space');
  await expect(c.onLock).toHaveAttribute('aria-checked', 'true');
  await c.keepRemote.check();

  // Test Connection writes a probe file into the folder
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 });

  // Auto-save (debounced) holds the whole form
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const cfg = (await window.nexus.sync.getConfig()) as {
            backendType?: string;
            backendConfig?: { directoryPath?: string };
            syncInterval?: number;
            syncOnLock?: boolean;
            syncOnLaunch?: boolean;
            conflictResolution?: string;
          } | null;
          return cfg
            ? [
                cfg.backendType,
                cfg.backendConfig?.directoryPath,
                cfg.syncInterval,
                cfg.syncOnLock,
                cfg.syncOnLaunch,
                cfg.conflictResolution,
              ].join('|')
            : null;
        }),
      { timeout: 10_000 }
    )
    .toBe(['filesystem', syncDir, 900, true, false, 'keep_remote'].join('|'));

  // Leave and come back: the form reloads what was saved
  await leaveSettings(page);
  await openVaultSync(page);
  await expectSavedSettings(page);

  // Push copies the vault into the folder and adds a history entry
  await page.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Sync push completed' })
  ).toBeVisible({ timeout: 15_000 });
  const history = page.getByRole('list', { name: 'Sync history' });
  await expect(history.getByRole('listitem').first()).toContainText('Pushed vault to remote');
  await expect(history.getByRole('listitem').first()).toContainText('Success');
  const files = readdirSync(syncDir);
  expect(files.some((f) => f.endsWith('.db'))).toBe(true);
  expect(files.some((f) => f.endsWith('.salt'))).toBe(true);

  // Restart: the settings are stored in the vault
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
  await openVaultSync(page);
  await expectSavedSettings(page);

  // Push straight after an edit (inside the 400 ms auto-save delay) uses the edited folder.
  await page.getByRole('textbox', { name: 'Directory path' }).fill(syncDir2);
  await page.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Sync push completed' })
  ).toBeVisible({ timeout: 15_000 });
  expect(readdirSync(syncDir2).some((f) => f.endsWith('.db'))).toBe(true);
});

/**
 * No control of the sync settings sticks out of <main> or of a box that clips it sideways,
 * and nothing scrolls sideways.
 */
async function expectSyncFormFits(p: Page, label: string): Promise<void> {
  await p.waitForTimeout(300); // let a resize settle
  const report = await p.evaluate(() => {
    const out: string[] = [];
    const main = document.querySelector('main');
    if (!main) return ['missing: main'];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1)
      out.push(`page scrolls sideways (${doc.scrollWidth} > ${window.innerWidth})`);
    if (main.scrollWidth > main.clientWidth + 1)
      out.push(`main scrolls sideways (${main.scrollWidth} > ${main.clientWidth})`);
    const name = (el: Element) =>
      (el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent ?? '')
        .trim()
        .slice(0, 30);
    for (const el of main.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [role="switch"]'
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      for (let box: HTMLElement | null = el.parentElement; box; box = box.parentElement) {
        const clips = box === main || getComputedStyle(box).overflowX !== 'visible';
        if (!clips) continue;
        const b = box.getBoundingClientRect();
        if (r.left < b.left - 1 || r.right > b.right + 1) {
          out.push(
            `${el.tagName.toLowerCase()} "${name(el)}" spans ${Math.round(r.left)}–${Math.round(r.right)}, ` +
              `clipped by ${box.tagName.toLowerCase()} ${Math.round(b.left)}–${Math.round(b.right)}`
          );
          break;
        }
        if (box === main) break;
      }
    }
    return out;
  });
  expect(report, label).toEqual([]);
}

test('sync settings fit the minimum window and a 4K one for every backend', async () => {
  expect(app, 'needs the app from the previous test').toBeDefined();
  const size = await app!.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(900, 600);
    return win.getSize();
  });
  expect(size).toEqual([900, 600]);

  const backend = page.getByRole('combobox', { name: 'Backend' });
  await expect(backend).toBeVisible();
  // Each backend's fields
  for (const type of ['sftp', 'ftp', 's3', 'filesystem']) {
    await backend.selectOption(type);
    await expectSyncFormFits(page, `${type} at 900x600`);
  }

  // A failed Test Connection (nothing listens on 127.0.0.1:1) wraps its error in the form
  await backend.selectOption('sftp');
  await page.getByPlaceholder('server.example.com').fill('127.0.0.1');
  await page.getByPlaceholder('22').fill('1');
  await page.getByPlaceholder('username').fill('nobody');
  await page.getByPlaceholder('/home/user/nexus-sync').fill('/srv/' + 'nested/'.repeat(20) + 'nexus');
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByText(/Connection failed/)).toBeVisible({ timeout: 70_000 });
  await expectSyncFormFits(page, 'sftp with an error at 900x600');

  // 4K (viewport emulation can't be undone, so it's last)
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expectSyncFormFits(page, 'sftp at 3840x2160');
});
