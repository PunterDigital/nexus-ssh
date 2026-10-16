import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Security timeouts are saved in the vault; the main process must pick them up when they change
// and again on the next unlock. Idle time can't be faked from here, so this drives the clipboard
// timeout, which goes through the same settings → security manager path as the auto-lock timeout.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-settings-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const SECRET = 'e2e-clipboard-secret';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
let app: ElectronApplication | undefined;

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: { ...process.env, NEXUS_USE_BUILT_RENDERER: '1', NEXUS_USER_DATA_DIR: userDataDir, NEXUS_DISABLE_IDLE_LOCK: '1' },
  });
}

const readClipboard = () => app!.evaluate(async ({ clipboard }) => clipboard.readText());

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
});

test('a changed clipboard timeout applies at once and again after an unlock', async () => {
  app = await launch();
  let page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Settings Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // Default is 30s; set it to 1s in Settings.
  await page.getByTitle('Settings').click();
  // The main process sends settings:changed only after it has saved and applied the value, so
  // wait for that instead of the input (which updates before the save lands).
  const applied = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const off = window.nexus.settings.onChanged((key, value) => {
          if (key === 'clipboardClearTimeout' && value === 1) {
            off();
            resolve();
          }
        });
      }),
  );
  await page.getByRole('spinbutton', { name: 'Clipboard clear timeout' }).fill('1');
  await applied;

  await page.evaluate((s) => window.nexus.clipboard.copySecure(s), SECRET);
  expect(await readClipboard()).toBe(SECRET);
  await expect.poll(readClipboard, { timeout: 5_000 }).toBe('');
  await app.close();

  // After a restart the saved 1s must be applied on unlock, not the 30s default.
  app = await launch();
  page = await app.firstWindow();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.evaluate((s) => window.nexus.clipboard.copySecure(s), SECRET);
  expect(await readClipboard()).toBe(SECRET);
  await expect.poll(readClipboard, { timeout: 5_000 }).toBe('');
});
