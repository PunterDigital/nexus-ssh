import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// #2662: Settings → Terminal applies to terminal sessions: new ones start with the saved values,
// open ones update when a value changes. GPU acceleration off means xterm's DOM renderer, whose
// rows the test can read (and is what that setting is for).
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-termset-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-termset-remote-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, remoteDir]) rmSync(dir, { recursive: true, force: true });
});

async function openTerminalSettings(): Promise<void> {
  await page.locator('header').getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Terminal', exact: true })
    .click();
  await expect(page.locator('main').getByRole('heading', { level: 3, name: 'Terminal' })).toBeVisible();
}

/** Wait until main has saved a setting (the inputs update before the save lands). */
const saved = (key: string, value: unknown) =>
  expect.poll(() => page.evaluate((k) => window.nexus.settings.get(k), key)).toEqual(value);

const rowCount = () => page.evaluate(() => document.querySelector('.xterm-rows')?.children.length ?? 0);

/** What the open terminal shows: the DOM renderer's font and cursor. */
const terminalLook = () =>
  page
    .locator('.xterm')
    .first()
    .evaluate((el) => {
      const rows = el.querySelector<HTMLElement>('.xterm-rows')!;
      const cursor = el.querySelector('.xterm-cursor');
      return {
        fontSize: getComputedStyle(rows).fontSize,
        fontFamily: getComputedStyle(rows).fontFamily,
        cursor: cursor
          ? [...cursor.classList].filter((c) => /^xterm-cursor-(block|underline|bar|outline)$/.test(c))
          : [],
        blink: rows.classList.contains('xterm-cursor-blink') || !!el.querySelector('.xterm-cursor-blink'),
        webgl: !!el.querySelector('canvas'),
      };
    });

test('terminal settings apply to new and open sessions', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: { ...process.env, NEXUS_USE_BUILT_RENDERER: '1', NEXUS_USER_DATA_DIR: userDataDir, NEXUS_DISABLE_IDLE_LOCK: '1' },
  });
  page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Terminal Settings');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // Before any session: DOM renderer, underline cursor without blink, 18 px Consolas.
  await openTerminalSettings();
  await page.getByRole('switch', { name: 'GPU acceleration' }).click();
  await page.getByRole('radiogroup', { name: 'Cursor style' }).getByText('Underline', { exact: true }).click();
  await page.getByRole('switch', { name: 'Cursor blink' }).click();
  await page.getByRole('spinbutton', { name: 'Font size' }).fill('18');
  await page.getByRole('combobox', { name: 'Font family' }).selectOption('Consolas');
  await saved('gpuAcceleration', false);
  await saved('cursorStyle', 'underline');
  await saved('cursorBlink', false);
  await saved('terminalFontSize', 18);
  await saved('terminalFont', 'Consolas');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Hosts', exact: true }).click();
  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('E2E Terminal Host');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();
  await page.getByRole('button', { name: /E2E Terminal Host/ }).first().click();
  await page.getByRole('button', { name: 'Accept Once' }).click({ timeout: 5_000 }).catch(() => {});
  await expect(page.locator('.xterm-rows')).toContainText('nexus-test-shell$', { timeout: 30_000 });

  let look = await terminalLook();
  expect(look.webgl).toBe(false);
  expect(look.fontSize).toBe('18px');
  expect(look.fontFamily.replace(/["']/g, '').startsWith('Consolas')).toBe(true);
  expect(look.cursor).toEqual(['xterm-cursor-underline']);
  expect(look.blink).toBe(false);

  // A change that arrives while the terminal is on screen (e.g. a sync pull) updates it in
  // place: same terminal element, no reconnect.
  await page.locator('.xterm').first().evaluate((el) => (el.dataset.e2eMark = 'same-terminal'));
  await page.evaluate(() => window.nexus.settings.set('cursorStyle', 'block'));
  await expect.poll(async () => (await terminalLook()).cursor).toEqual(['xterm-cursor-block']);
  await expect(page.locator('.xterm[data-e2e-mark="same-terminal"]')).toHaveCount(1);

  // Changed in Settings while the session is open (the terminal view unmounts; main replays the
  // output when it comes back): back on it, the terminal has the new values and the old output.
  await page.locator('.xterm').first().click();
  await page.keyboard.type('echo before-settings');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('before-settings');
  const rowsBefore = await rowCount();
  await openTerminalSettings();
  await page.getByRole('radiogroup', { name: 'Cursor style' }).getByText('Bar', { exact: true }).click();
  await page.getByRole('switch', { name: 'Cursor blink' }).click();
  await page.getByRole('spinbutton', { name: 'Font size' }).fill('12');
  await saved('cursorStyle', 'bar');
  await saved('cursorBlink', true);
  await saved('terminalFontSize', 12);

  await page.getByRole('tablist', { name: 'Open sessions' }).getByRole('tab', { name: /E2E Terminal Host/ }).click();
  await expect.poll(async () => (await terminalLook()).fontSize).toBe('12px');
  await expect(page.locator('.xterm-rows')).toContainText('before-settings');
  look = await terminalLook();
  expect(look.cursor).toEqual(['xterm-cursor-bar']);
  expect(look.blink).toBe(true);
  // A smaller font fits more rows in the same space, and the session is still connected.
  await expect.poll(rowCount).toBeGreaterThan(rowsBefore);
  await page.locator('.xterm').first().click();
  await page.keyboard.type('echo still-connected');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText(/still-connected[\s\S]*still-connected/);
});
