import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// PIN quick-unlock (#2653): set up in Settings, unlock with it, 5 wrong PINs turn it off and show
// the method picker, "Use another method", turning it off, and a restart forgetting it.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-pin-'));
const PASSWORD = 'e2e-Pin-Unlock-53!';
const PIN = '2468';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let app: ElectronApplication | undefined;

function launch(): Promise<ElectronApplication> {
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

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
});

const unlocked = (page: Page) =>
  expect(page.getByRole('button', { name: 'Lock vault' })).toBeVisible({ timeout: 30_000 });

async function openSecuritySettings(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
}

async function setUpPin(page: Page, pin: string): Promise<void> {
  await openSecuritySettings(page);
  await page.getByRole('button', { name: 'Set Up PIN…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set Up PIN Unlock' });
  await dialog.getByLabel('PIN', { exact: true }).fill(pin);
  await dialog.getByLabel('Confirm PIN').fill(pin);
  await dialog.getByRole('button', { name: 'Turn On' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'PIN unlock is on' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change PIN…' })).toBeVisible();
}

async function lock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await expect(page.getByRole('heading', { name: 'Nexus' })).toBeVisible({ timeout: 30_000 });
}

async function enterPin(page: Page, pin: string): Promise<void> {
  await page.getByLabel('PIN', { exact: true }).fill(pin);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
}

test('PIN unlock: set up, unlock, lockout to the method picker, turn off, forgotten on restart', async () => {
  test.setTimeout(240_000);
  app = await launch();
  let page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('PIN Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await unlocked(page);

  // Validation in the setup dialog
  await openSecuritySettings(page);
  await page.getByRole('button', { name: 'Set Up PIN…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set Up PIN Unlock' });
  await dialog.getByLabel('PIN', { exact: true }).fill('12');
  await dialog.getByRole('button', { name: 'Turn On' }).click();
  await expect(dialog.getByText('Use 4 to 8 digits')).toBeVisible();
  // Letters are dropped as they are typed
  await dialog.getByLabel('PIN', { exact: true }).fill('');
  await dialog.getByLabel('PIN', { exact: true }).pressSequentially('12ab34');
  await expect(dialog.getByLabel('PIN', { exact: true })).toHaveValue('1234');
  await dialog.getByLabel('Confirm PIN').fill('1235');
  await dialog.getByLabel('Confirm PIN').press('Enter');
  await expect(dialog.getByText("The PINs don't match")).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Set Up PIN…' })).toBeVisible();

  // Set it up, lock, unlock with the PIN
  await setUpPin(page, PIN);
  await lock(page);
  await expect(page.getByText('Enter your PIN to unlock')).toBeVisible();
  await expect(page.getByLabel('PIN', { exact: true })).toBeFocused();
  await enterPin(page, PIN);
  await unlocked(page);

  // "Use another method" offers the PIN and the master password; the password works too
  await lock(page);
  await page.getByRole('button', { name: 'Use another method' }).click();
  await expect(page.getByText('Choose how to unlock')).toBeVisible();
  const methods = page.getByRole('list', { name: 'Unlock methods' });
  await expect(methods.getByRole('button')).toHaveText(['PIN', 'Master Password']);
  await methods.getByRole('button', { name: 'PIN' }).click();
  await expect(page.getByLabel('PIN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use another method' }).click();
  await methods.getByRole('button', { name: 'Master Password' }).click();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await unlocked(page);

  // Five wrong PINs: attempts count down, then PIN unlock turns off and the picker opens
  await lock(page);
  for (const left of [4, 3, 2, 1]) {
    await enterPin(page, '1111');
    await expect(page.getByText(`Wrong PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`)).toBeVisible();
    await expect(page.getByLabel('PIN', { exact: true })).toHaveValue('');
  }
  await enterPin(page, '1111');
  await expect(page.getByText('Choose how to unlock')).toBeVisible();
  await expect(page.getByText(/Too many wrong PINs/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Unlock methods' }).getByRole('button')).toHaveText([
    'Master Password',
  ]);
  await page.getByRole('button', { name: 'Master Password' }).click();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await unlocked(page);

  // The PIN is gone after the lockout: Settings offers to set one up again
  await openSecuritySettings(page);
  await expect(page.getByRole('button', { name: 'Set Up PIN…' })).toBeVisible();

  // Turn it on, then off: the lock screen asks for the password
  await setUpPin(page, PIN);
  await page.getByRole('button', { name: 'Turn Off' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'PIN unlock is off' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set Up PIN…' })).toBeVisible();
  await lock(page);
  await expect(page.getByText('Enter password to unlock')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use another method' })).toHaveCount(0);
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await unlocked(page);

  // A restart forgets the PIN: a cold start always needs the master password
  await setUpPin(page, PIN);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByText('Enter password to unlock')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('PIN', { exact: true })).toHaveCount(0);
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await unlocked(page);
  await openSecuritySettings(page);
  await expect(page.getByRole('button', { name: 'Set Up PIN…' })).toBeVisible();
});
