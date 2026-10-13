import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// When the main process locks the vault on its own (OS screen lock, sleep, idle timeout), the
// renderer must drop the vault data and show the lock screen, not keep showing the hosts.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-lock-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const HOST = 'E2E Lock Host';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
let app: ElectronApplication | undefined;

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
});

test('an OS screen lock locks the vault and shows the lock screen', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: { ...process.env, NEXUS_USE_BUILT_RENDERER: '1', NEXUS_USER_DATA_DIR: userDataDir, NEXUS_DISABLE_IDLE_LOCK: '1' },
  });
  const page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Lock Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill(HOST);
  await page.getByPlaceholder('192.168.1.1 or example.com').fill('127.0.0.1');
  await page.getByPlaceholder('root').fill('e2e');
  await page.getByRole('button', { name: 'Create Host' }).click();
  await expect(page.getByText(HOST).first()).toBeVisible();

  // Same path as a real OS screen lock: the security manager's powerMonitor listener.
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('lock-screen');
  });

  await expect(page.getByPlaceholder('Master password')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(HOST)).toHaveCount(0);

  // Unlocking brings the app (and the vault's data) back.
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText(HOST).first()).toBeVisible({ timeout: 30_000 });
});
