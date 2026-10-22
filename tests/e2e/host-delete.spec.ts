import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// Deleting a host (#3098): from the card's "More actions" menu and from the Edit host dialog,
// with a confirmation that can be cancelled. A connected host's tab is closed with it. The host
// is gone from the list and stays gone after a restart (removed from the vault, not just the view).
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-hostdelete-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-hostdelete-remote-'));
const PASSWORD = 'e2e-Delete-Host-98!';
const HOST_A = 'Delete Me';
const HOST_B = 'Delete Me Too';
const KEEP = 'Keep Me';
const LIVE = 'Live Host';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication | undefined;
let page: Page;
let server: TestServer | undefined;

async function launch(): Promise<void> {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
  page = await app.firstWindow();
}

test.beforeAll(async () => {
  await launch();
  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Delete Host Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(remoteDir, { recursive: true, force: true });
});

const main = () => page.locator('main');

async function createHost(label: string, hostname: string): Promise<void> {
  await page.getByRole('button', { name: 'New Host' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New Host' });
  await dialog.getByPlaceholder('My Server').fill(label);
  await dialog.getByPlaceholder('192.168.1.1 or example.com').fill(hostname);
  await dialog.getByPlaceholder('root').fill('e2e');
  await dialog.getByRole('button', { name: 'Create Host' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main().getByText(label, { exact: true })).toBeVisible();
}

// "Delete Me" is a prefix of "Delete Me Too": the menu buttons need exact names.
const moreActions = (label: string) => main().getByRole('button', { name: `More actions for ${label}`, exact: true });

test('three hosts exist', async () => {
  await createHost(HOST_A, '10.0.0.1');
  await createHost(HOST_B, '10.0.0.2');
  await createHost(KEEP, '10.0.0.3');
});

test('the host menu has a danger "Delete host…" entry; Cancel keeps the host', async () => {
  await moreActions(HOST_A).click();
  const item = page.getByRole('menuitem', { name: 'Delete host…' });
  await expect(item).toBeVisible();
  await item.click();

  const dialog = page.getByRole('dialog', { name: `Delete ${HOST_A}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('removes the host and its saved login details')).toBeVisible();
  // No tab is open on it, so nothing about tabs is said.
  await expect(dialog.getByText(/open tab/)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main().getByText(HOST_A, { exact: true })).toBeVisible();
});

test('confirming from the menu deletes the host and shows a toast', async () => {
  await moreActions(HOST_A).click();
  await page.getByRole('menuitem', { name: 'Delete host…' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${HOST_A}?` });
  await dialog.getByRole('button', { name: 'Delete Host' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Host "${HOST_A}" deleted` })).toBeVisible();
  await expect(main().getByText(HOST_A, { exact: true })).toHaveCount(0);
  await expect(main().getByText(HOST_B, { exact: true })).toBeVisible();
  await expect(main().getByText(KEEP, { exact: true })).toBeVisible();
});

test('the Edit host dialog has a Delete button that opens the same confirmation', async () => {
  await main().getByText(HOST_B, { exact: true }).click({ button: 'right' });
  const edit = page.getByRole('dialog', { name: `Edit ${HOST_B}` });
  const menu = page.getByRole('menu');
  await expect(edit.or(menu)).toBeVisible();
  if (await menu.isVisible()) await menu.getByRole('menuitem', { name: /^Edit/ }).click();
  await expect(edit).toBeVisible();

  await edit.getByRole('button', { name: 'Delete…' }).click();
  await expect(edit).toHaveCount(0);
  const confirm = page.getByRole('dialog', { name: `Delete ${HOST_B}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete Host' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(main().getByText(HOST_B, { exact: true })).toHaveCount(0);
  await expect(main().getByText(KEEP, { exact: true })).toBeVisible();
});

test('deleting a connected host says so and closes its terminal tab', async () => {
  server = await startTestServer({ root: remoteDir });
  await page.getByRole('button', { name: 'New Host' }).first().click();
  const form = page.getByRole('dialog', { name: 'New Host' });
  await form.getByPlaceholder('My Server').fill(LIVE);
  await form.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await form.getByPlaceholder('22').fill(String(server.port));
  await form.getByPlaceholder('root').fill(server.username);
  await form.getByPlaceholder('Enter password').fill(server.password);
  await form.getByRole('button', { name: 'Create Host' }).click();
  await expect(form).toHaveCount(0);

  // Connect: the terminal view opens with a session tab for the host.
  await main().getByRole('button', { name: new RegExp(LIVE) }).first().click();
  await page.getByRole('button', { name: 'Accept Once' }).click({ timeout: 5_000 }).catch(() => {});
  // (xterm renders with WebGL here, so the shell text isn't in the DOM: the server's connection
  // count says the session is up.)
  const tabs = page.getByRole('tablist', { name: 'Open sessions' }).getByRole('tab');
  await expect(tabs.filter({ hasText: LIVE })).toHaveCount(1);
  await expect.poll(() => server!.openConnections(), { timeout: 30_000 }).toBe(1);
  await expect(page.locator('.xterm')).toBeVisible({ timeout: 30_000 });

  // Back to Hosts, delete it: the confirmation mentions the open tab.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Hosts' }).click();
  await moreActions(LIVE).click();
  await page.getByRole('menuitem', { name: 'Delete host…' }).click();
  const confirm = page.getByRole('dialog', { name: `Delete ${LIVE}?` });
  await expect(confirm.getByText('This host has 1 open tab, which will be closed and disconnected.')).toBeVisible();
  if (process.env.E2E_SCREENSHOT_DIR) {
    // Let the dialog's open transition finish before the PR screenshot.
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(process.env.E2E_SCREENSHOT_DIR, 'delete-host-dialog.png') });
  }
  await confirm.getByRole('button', { name: 'Delete Host' }).click();
  await expect(confirm).toHaveCount(0);

  await expect(main().getByText(LIVE, { exact: true })).toHaveCount(0);
  await expect(tabs.filter({ hasText: LIVE })).toHaveCount(0);
  await expect.poll(() => server!.openConnections(), { timeout: 15_000 }).toBe(0);
});

test('the New Host dialog has no Delete button', async () => {
  await page.getByRole('button', { name: 'New Host' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New Host' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete…' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('deleted hosts stay deleted after a restart', async () => {
  await app?.close();
  await launch();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(main().getByText(KEEP, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(main().getByText(HOST_A, { exact: true })).toHaveCount(0);
  await expect(main().getByText(HOST_B, { exact: true })).toHaveCount(0);
  await expect(main().getByText(LIVE, { exact: true })).toHaveCount(0);
});
