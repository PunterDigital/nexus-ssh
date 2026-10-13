import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { version } from '../../package.json';

// Launches the built app (run `pnpm build` first) with an isolated profile, so a real vault is never touched.
// Set NEXUS_E2E_EXECUTABLE to a packaged binary (e.g. dist-release/win-unpacked/Nexus.exe) to test that instead.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
}

test.afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

test('first run: create an encrypted vault, then unlock it after a restart', async () => {
  const app = await launch();
  const page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();

  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Nexus v${version}`)).toBeVisible();
  await app.close();

  // Relaunch: the vault must reopen with the master password (exercises SQLCipher + Argon2id).
  const app2 = await launch();
  const page2 = await app2.firstWindow();
  await page2.getByPlaceholder('Master password').fill(PASSWORD);
  await page2.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page2.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
  await app2.close();
});
