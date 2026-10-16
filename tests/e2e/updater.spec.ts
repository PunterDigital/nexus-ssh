import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Update checks against a local fake of the GitHub "latest release" API. NEXUS_UPDATE_TEST_URL
// puts the app in notify mode (the macOS flow) even in dev / with a test profile; without it a
// test profile never checks. The Windows "Restart to update" card is driven by pushing a
// `downloaded` status, since electron-updater can't install from a test feed.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-updater-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
let app: ElectronApplication | undefined;
let feed: http.Server;
let feedUrl = '';
let feedHits = 0;

test.beforeAll(async () => {
  feed = http.createServer((_req, res) => {
    feedHits++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tag_name: 'v99.0.0' }));
  });
  await new Promise<void>((r) => feed.listen(0, '127.0.0.1', () => r()));
  feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/releases/latest`;
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  feed.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

function launch(extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
      ...extraEnv,
    },
  });
}

/** Record shell.openExternal calls instead of opening a real browser. */
async function stubOpenExternal(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __opened: string[] }).__opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}

const opened = () =>
  app!.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened);

test('update checks: notify card, Later, manual check, the setting, and Restart to update', async () => {
  app = await launch({ NEXUS_UPDATE_TEST_URL: feedUrl });
  await stubOpenExternal(app);
  const page = await app.firstWindow();

  // The launch check runs a few seconds after startup and shows the card on the lock screen too.
  const card = page.getByRole('region', { name: 'App update' });
  await expect(card).toContainText('Nexus v99.0.0 is available.', { timeout: 20_000 });
  await card.getByRole('button', { name: 'Download' }).click();
  await expect.poll(opened).toEqual(['https://punterdigital.github.io/personal-apps/']);

  await card.getByRole('button', { name: 'Later' }).click();
  await expect(card).toBeHidden();

  // Into the app: a manual "Check for Updates" brings the card back.
  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Updater Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
  await expect(card).toBeHidden(); // still dismissed

  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const hitsBefore = feedHits;
  await page.getByRole('button', { name: 'Check for Updates' }).click();
  await expect(card).toContainText('Nexus v99.0.0 is available.');
  expect(feedHits).toBeGreaterThan(hitsBefore);

  // Turn automatic checks off (General) — saved app-wide, outside the vault.
  await page.getByRole('button', { name: 'General', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Check for updates automatically' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect
    .poll(() => JSON.parse(readFileSync(path.join(userDataDir, 'app-settings.json'), 'utf8')).checkForUpdates)
    .toBe(false);

  // Windows flow: once electron-updater has downloaded, the card offers a restart. With nothing
  // really downloaded the main process refuses, which proves the button reaches it.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('updater:status', {
      state: 'downloaded',
      mode: 'install',
      version: '99.0.1',
    });
  });
  await expect(card).toContainText('Nexus v99.0.1 is ready to install.');
  await card.getByRole('button', { name: 'Restart to update' }).click();
  await expect(page.getByRole('alert')).toContainText('No update has been downloaded yet.');
  await app.close();

  // Relaunch with checks off: the feed is never asked and no card appears.
  const hitsAtRestart = feedHits;
  app = await launch({ NEXUS_UPDATE_TEST_URL: feedUrl });
  const page2 = await app.firstWindow();
  await expect(page2.getByPlaceholder('Master password')).toBeVisible({ timeout: 30_000 });
  await page2.waitForTimeout(8_000); // past the 5 s first-check delay
  expect(feedHits).toBe(hitsAtRestart);
  await expect(page2.getByRole('region', { name: 'App update' })).toBeHidden();
  await app.close();
  app = undefined;
});

test('a test profile without a feed never checks for updates', async () => {
  const before = feedHits;
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.getByPlaceholder('Master password')).toBeVisible({ timeout: 30_000 });
  const status = await page.evaluate(() => window.nexus.updater.getStatus());
  expect(status).toEqual({ state: 'idle', mode: 'off' });
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await page.getByRole('button', { name: 'Check for Updates' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'only run in the installed app' })).toBeVisible();
  expect(feedHits).toBe(before);
});
