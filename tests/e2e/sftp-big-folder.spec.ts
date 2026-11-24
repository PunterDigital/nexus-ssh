import { test, expect, _electron as electron, type ElectronApplication, type Locator } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// #5667: a 10,000-entry folder rendered 10,000 rows, and each row checked the selection with
// an O(n) includes(), so a select-all was O(n²). The panes now render only the rows in view.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-bigdir-'));
const localDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-bigdir-local-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-bigdir-remote-'));
const PASSWORD = 'e2e-Big-Folder-67!';
const COUNT = 10_000;
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
const name = (i: number) => `file-${String(i).padStart(5, '0')}.log`;

let server: TestServer;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  for (let i = 0; i < COUNT; i++) {
    writeFileSync(path.join(localDir, name(i)), '');
    writeFileSync(path.join(remoteDir, name(i)), '');
  }
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, localDir, remoteDir]) rmSync(dir, { recursive: true, force: true });
});

/** Time a synchronous keyboard/mouse event on `target` in the page, through React's commit. */
async function timeEvent(list: Locator, kind: 'select-all' | 'click-row'): Promise<number> {
  return list.evaluate(async (el, k) => {
    const started = performance.now();
    if (k === 'select-all') {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    } else {
      const row = el.querySelector<HTMLElement>('[role="option"][data-index="3"]')!;
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    // React commits discrete events synchronously; one frame for layout/paint.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return performance.now() - started;
  }, kind);
}

test('a 10,000-file folder renders a window of rows; select-all, clicks and the keyboard stay quick', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
  const page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Big Folder');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('Big Folder Server');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();
  await page.getByRole('button', { name: /Big Folder Server/ }).first().click();
  await page
    .getByRole('button', { name: 'Accept Once' })
    .click({ timeout: 15_000 })
    .catch(() => {});

  const remoteList = page.getByRole('listbox', { name: 'Remote files' });
  const localList = page.getByRole('listbox', { name: 'Local files' });
  await expect(remoteList.getByRole('option', { name: name(0), exact: true })).toBeVisible({ timeout: 60_000 });

  // Local pane → the 10,000-file folder (timed: the main-side listing is part of it).
  await page.getByRole('button', { name: 'Edit local path' }).click();
  const localPath = page.getByRole('textbox', { name: 'Local path' });
  await localPath.fill(localDir);
  const t = Date.now();
  await localPath.press('Enter');
  await expect(localList.getByRole('option', { name: name(0), exact: true })).toBeVisible({ timeout: 60_000 });
  console.log(`E2E local 10k listing shown in ${Date.now() - t} ms`);

  for (const [label, list] of [['remote', remoteList], ['local', localList]] as const) {
    const rendered = await list.getByRole('option').count();
    const selectAll = await timeEvent(list, 'select-all');
    const click = await timeEvent(list, 'click-row');
    console.log(`E2E ${label}: ${rendered} option rows, select-all ${selectAll.toFixed(0)} ms, click ${click.toFixed(0)} ms`);
    expect(rendered).toBeLessThanOrEqual(60);
    expect(selectAll).toBeLessThan(100);
    expect(click).toBeLessThan(100);
  }

  // Keyboard: End reaches the last entry (rendered on demand, focused), Home goes back.
  const remoteRow = (n: string) => remoteList.getByRole('option', { name: n, exact: true });
  await remoteRow(name(3)).click();
  await page.keyboard.press('End');
  await expect(remoteRow(name(COUNT - 1))).toBeFocused();
  await expect(remoteRow(name(COUNT - 1))).toHaveAttribute('aria-selected', 'true');
  await expect(remoteRow(name(COUNT - 1))).toHaveAttribute('aria-posinset', String(COUNT));
  expect(await remoteList.getByRole('option').count()).toBeLessThanOrEqual(60);
  await page.keyboard.press('ArrowUp');
  await expect(remoteRow(name(COUNT - 2))).toBeFocused();
  await page.keyboard.press('Home');
  await expect(remoteRow(name(0))).toBeFocused();
  // Shift+End selects the whole folder.
  await page.keyboard.press('Shift+End');
  await expect(remoteRow(name(COUNT - 1))).toHaveAttribute('aria-selected', 'true');
  await remoteList.evaluate((el) => {
    el.parentElement!.scrollTop = el.scrollHeight / 2;
  });
  await expect(remoteRow(name(COUNT / 2))).toHaveAttribute('aria-selected', 'true');

  // Scrolling the pane renders the rows that come into view.
  await localList.evaluate((el) => {
    el.parentElement!.scrollTop = el.scrollHeight;
  });
  await expect(localList.getByRole('option', { name: name(COUNT - 1), exact: true })).toBeVisible();
});
