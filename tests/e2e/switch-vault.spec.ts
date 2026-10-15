import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// "Switch vault" (#2363): from an open vault, go back to the vault picker without restarting,
// open another vault, and only see that vault's hosts. Open sessions are closed after a confirm.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-switch-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-switch-remote-'));
const PASSWORD_A = 'e2e-Work-Horse-42!';
const PASSWORD_B = 'e2e-Home-Battery-43!';
const HOST_A = 'Work Only Host';
const HOST_B = 'Home Test Server';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, remoteDir]) rmSync(dir, { recursive: true, force: true });
});

async function createVault(page: Page, name: string, password: string): Promise<void> {
  await page.getByPlaceholder('My Vault').fill(name);
  await page.getByPlaceholder('Choose a strong password').fill(password);
  await page.getByPlaceholder('Repeat your password').fill(password);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
}

async function addHost(
  page: Page,
  label: string,
  opts: { port?: number; username: string; password?: string },
): Promise<void> {
  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill(label);
  await page.getByPlaceholder('192.168.1.1 or example.com').fill('127.0.0.1');
  if (opts.port) await page.getByPlaceholder('22').fill(String(opts.port));
  await page.getByPlaceholder('root').fill(opts.username);
  if (opts.password) await page.getByPlaceholder('Enter password').fill(opts.password);
  await page.getByRole('button', { name: 'Create Host' }).click();
  await expect(page.getByText(label).first()).toBeVisible();
}

async function switchVault(page: Page): Promise<void> {
  await page.getByTitle('Vault menu').click();
  await page.getByRole('menuitem', { name: 'Switch Vault…' }).click();
}

test('switch between two vaults without restarting; each shows its own hosts', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: { ...process.env, NEXUS_USE_BUILT_RENDERER: '1', NEXUS_USER_DATA_DIR: userDataDir, NEXUS_DISABLE_IDLE_LOCK: '1' },
  });
  const page = await app.firstWindow();

  // Vault A with one host
  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await createVault(page, 'Work Vault', PASSWORD_A);
  await addHost(page, HOST_A, { username: 'e2e' });
  await expect(page.getByTitle('Vault menu')).toContainText('Work Vault');

  // No sessions open: the switch goes straight to the picker, even with a single vault.
  await switchVault(page);
  await expect(page.getByRole('heading', { name: 'Select a Vault' })).toBeVisible();
  await expect(page.getByText(HOST_A)).toHaveCount(0);

  // Vault B, created from the picker, starts empty and gets its own host
  await page.getByRole('button', { name: 'Create New Vault' }).click();
  await createVault(page, 'Home Vault', PASSWORD_B);
  await expect(page.getByText(HOST_A)).toHaveCount(0);
  await expect(page.getByTitle('Vault menu')).toContainText('Home Vault');
  await addHost(page, HOST_B, { port: server.port, username: server.username, password: server.password });

  // Open a terminal session in vault B
  await page.getByRole('button', { name: new RegExp(HOST_B) }).first().click();
  await page
    .getByRole('button', { name: 'Accept Once' })
    .click({ timeout: 5_000 })
    .catch(() => {});
  await expect.poll(() => server.openConnections(), { timeout: 30_000 }).toBeGreaterThan(0);

  // With a session open the switch asks first; Cancel keeps everything as it was.
  await switchVault(page);
  const dialog = page.getByText('Your open session will be closed');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(server.openConnections()).toBeGreaterThan(0);

  // Confirm: the session is closed and the picker lists both vaults.
  await switchVault(page);
  await page.getByRole('button', { name: 'Close Sessions and Switch' }).click();
  await expect(page.getByRole('heading', { name: 'Select a Vault' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('You have 2 vaults')).toBeVisible();
  await expect.poll(() => server.openConnections(), { timeout: 10_000 }).toBe(0);

  // Back into vault A: its host, not B's, and no session tabs carried over.
  await page.getByRole('button', { name: /Work Vault/ }).click();
  await page.getByPlaceholder('Master password').fill(PASSWORD_A);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText(HOST_A).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(HOST_B)).toHaveCount(0);
  await expect(page.getByTitle('Vault menu')).toContainText('Work Vault');

  // And back to vault B: only its host.
  await switchVault(page);
  await page.getByRole('button', { name: /Home Vault/ }).click();
  await page.getByPlaceholder('Master password').fill(PASSWORD_B);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText(HOST_B).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(HOST_A)).toHaveCount(0);
});
