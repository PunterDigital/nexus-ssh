import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// #5661: Argon2id moved to a worker thread and the change-password reopen reuses the new
// key. The vault must still rekey, reopen with the new password after a restart, and refuse
// the old one. (No UI calls changePassword yet, so the test calls the preload API.)
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-chpw-'));
const OLD = 'e2e-Old-Password-61!';
const NEW = 'e2e-New-Password-61!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

const launch = (): Promise<ElectronApplication> =>
  electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });

test.afterAll(() => rmSync(userDataDir, { recursive: true, force: true }));

test('change password rekeys the vault: the new password opens it after a restart, the old one does not', async () => {
  const app = await launch();
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Password Change');
  await page.getByPlaceholder('Choose a strong password').fill(OLD);
  await page.getByPlaceholder('Repeat your password').fill(OLD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.evaluate(
    ([o, n]) =>
      (window as unknown as { nexus: { vault: { changePassword(a: string, b: string): Promise<unknown> } } }).nexus.vault.changePassword(o, n),
    [OLD, NEW],
  );
  // Still open (the reopen after the rekey worked).
  const current = await page.evaluate(() =>
    (window as unknown as { nexus: { vault: { current(): Promise<unknown> } } }).nexus.vault.current(),
  );
  expect(current).toBeTruthy();
  await app.close();

  const app2 = await launch();
  const page2 = await app2.firstWindow();
  await page2.getByPlaceholder('Master password').fill(OLD);
  await page2.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page2.getByText(/wrong password/i)).toBeVisible({ timeout: 30_000 });
  await page2.getByPlaceholder('Master password').fill(NEW);
  await page2.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page2.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
  await app2.close();
});
