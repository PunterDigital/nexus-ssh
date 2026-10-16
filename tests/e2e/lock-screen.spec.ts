import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Lock screen and vault creation on the design system (#2366): validation in the create form,
// show / hide password, Enter submits, a wrong password is reported and the right one unlocks.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-lock-'));
const PASSWORD = 'e2e-Lock-Screen-45!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let app: ElectronApplication | undefined;

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
});

test('create a vault with validation, then lock it and unlock after a wrong password', async () => {
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
  // Smallest window: the create form is taller than it, so the page must scroll, not clip.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(400, 300)
  );

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Vault' })).toBeVisible();
  const create = page.getByRole('button', { name: 'Create Vault', exact: true });
  const password = page.getByLabel('Master password');
  const confirm = page.getByLabel('Confirm password');

  // Labels are wired to the fields (Field primitive)
  await page.getByLabel('Vault name').fill('Lock Screen Vault');

  // Weak password: meter says so, the hint explains, Create stays off
  await password.fill('abc');
  const meter = page.getByRole('meter', { name: 'Password strength' });
  await expect(meter).toHaveAttribute('aria-valuetext', 'Weak');
  await expect(page.getByText(/Too weak to use/)).toBeVisible();
  await expect(create).toBeDisabled();

  // Strong password, wrong confirmation: error on the field, Create still off
  await password.fill(PASSWORD);
  await expect(meter).toHaveAttribute('aria-valuetext', 'Strong');
  await confirm.fill(`${PASSWORD}x`);
  await expect(page.getByText('Passwords do not match')).toBeVisible();
  await expect(confirm).toHaveAttribute('aria-invalid', 'true');
  await expect(create).toBeDisabled();

  // Show / hide is a keyboard-reachable toggle
  const show = page.getByRole('button', { name: 'Show password' }).first();
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(
    page.getByRole('button', { name: 'Hide password' }).first()
  ).toHaveAttribute('aria-pressed', 'true');

  // Matching confirmation; Enter in the field submits the form
  await confirm.fill(PASSWORD);
  await expect(page.getByText('Passwords match')).toBeVisible();
  await expect(create).toBeEnabled();
  await confirm.press('Enter');
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // Lock: the lock screen names the vault
  await page.getByRole('button', { name: 'Lock vault' }).click();
  const unlock = page.getByRole('button', { name: 'Unlock', exact: true });
  await expect(unlock).toBeVisible();
  await expect(page.getByText('Lock Screen Vault')).toBeVisible();
  await expect(unlock).toBeDisabled();

  // Wrong password: reported, field cleared, still locked
  const master = page.getByPlaceholder('Master password');
  await master.fill('not-the-password');
  await master.press('Enter');
  await expect(page.getByText('Wrong password')).toBeVisible({ timeout: 30_000 });
  await expect(master).toHaveValue('');
  await expect(master).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('No connections yet')).toHaveCount(0);

  // Right password via Enter
  await master.fill(PASSWORD);
  await master.press('Enter');
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
});
