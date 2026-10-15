import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// Host-key trust on first use, through the UI, against a throwaway local SSH server
// (never a real host) and an isolated profile.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-hostkey-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-remote-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, remoteDir])
    rmSync(dir, { recursive: true, force: true });
});

test('an unknown host key is asked about; Reject blocks it, Always Accept remembers it', async () => {
  app = await electron.launch({
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
  const page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Host Key Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('E2E Test Server');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);

  // "Test Connection" in the host form asks too
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByText('Unknown Host Key')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Accept Once' }).click();
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Create Host' }).click();

  // The host card (the terminal tab has the same name but not the address).
  const hostCard = page
    .getByRole('button', { name: /E2E Test Server/ })
    .filter({ hasText: server.host })
    .first();
  const connected = page.getByText('E2E Test Server (connected)');
  const unknownKey = page.getByText('Unknown Host Key');

  // 1. Unknown key → prompt with a fingerprint; Reject → no session
  await hostCard.click();
  await expect(unknownKey).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/SHA256:[A-Za-z0-9+/]{43}/)).toBeVisible();
  await page.getByRole('button', { name: 'Reject' }).click();
  await expect(unknownKey).toBeHidden();
  await page.waitForTimeout(1_000);
  await expect(connected).toBeHidden();

  // 2. Ask again; Always Accept → connected
  await page.getByRole('button', { name: 'Hosts', exact: true }).first().click();
  await hostCard.click();
  await expect(unknownKey).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Always Accept' }).click();
  await expect(connected).toBeVisible({ timeout: 30_000 });

  // 3. The key is remembered: a new connection (SFTP opens its own) doesn't ask
  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await hostCard.click();
  await expect(page.getByTitle('Click to edit path')).toHaveCount(2, { timeout: 30_000 });
  await expect(unknownKey).toBeHidden();
});
