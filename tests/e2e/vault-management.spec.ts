import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Vault management from the vault picker (#2646): rename, show in folder, and delete (to the
// Recycle Bin, here a test folder via NEXUS_TRASH_DIR) without the vault's password.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-vaults-'));
const trashDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-vaults-trash-'));
const vaultsDir = path.join(userDataDir, 'vaults');
const hwkeyDir = path.join(userDataDir, 'hwkey-store');
const PASSWORD_A = 'e2e-Alpha-Lantern-51!';
const PASSWORD_B = 'e2e-Beta-Compass-52!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let app: ElectronApplication | undefined;

test.afterAll(async () => {
  await app?.close().catch(() => {});
  for (const dir of [userDataDir, trashDir]) rmSync(dir, { recursive: true, force: true });
});

async function createVault(page: Page, name: string, password: string): Promise<void> {
  await page.getByPlaceholder('My Vault').fill(name);
  await page.getByPlaceholder('Choose a strong password').fill(password);
  await page.getByPlaceholder('Repeat your password').fill(password);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
}

async function switchVault(page: Page): Promise<void> {
  await page.getByTitle('Vault menu').click();
  await page.getByRole('menuitem', { name: 'Switch Vault…' }).click();
  await expect(page.getByRole('heading', { name: 'Select a Vault' })).toBeVisible({ timeout: 30_000 });
}

async function vaultAction(page: Page, vault: string, action: string): Promise<void> {
  await page.getByRole('button', { name: `More actions for ${vault}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

const vaultFiles = () => readdirSync(vaultsDir).sort();

test('rename, show in folder and delete vaults from the vault picker', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
      NEXUS_TRASH_DIR: trashDir,
    },
  });
  const page = await app.firstWindow();

  // Two vaults
  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await createVault(page, 'Alpha', PASSWORD_A);
  await switchVault(page);
  await page.getByRole('button', { name: 'Create New Vault' }).click();
  await createVault(page, 'Beta', PASSWORD_B);
  await switchVault(page);
  await expect(page.getByText('You have 2 vaults')).toBeVisible();
  expect(vaultFiles()).toEqual(['Alpha.db', 'Alpha.db.salt', 'Beta.db', 'Beta.db.salt']);

  // Unlock data kept outside the vault folder must follow a rename (a stand-in .hwkey file).
  mkdirSync(hwkeyDir, { recursive: true });
  writeFileSync(path.join(hwkeyDir, 'Alpha.hwkey'), 'test');

  // Rename Alpha: the files (and its .hwkey) move, the picker shows the new name.
  await vaultAction(page, 'Alpha', 'Rename…');
  const rename = page.getByRole('dialog', { name: 'Rename Alpha' });
  await expect(rename.getByLabel('Vault name')).toHaveValue('Alpha');
  await rename.getByLabel('Vault name').fill('Beta');
  await rename.getByRole('button', { name: 'Rename Vault' }).click();
  await expect(rename.getByText('A vault called "Beta" already exists')).toBeVisible();
  await rename.getByLabel('Vault name').fill('Alpha Work');
  await rename.getByLabel('Vault name').press('Enter');
  await expect(rename).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Renamed to Alpha Work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More actions for Alpha Work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More actions for Alpha', exact: true })).toHaveCount(0);
  expect(vaultFiles()).toEqual(['Alpha Work.db', 'Alpha Work.db.salt', 'Beta.db', 'Beta.db.salt']);
  expect(readdirSync(hwkeyDir)).toEqual(['Alpha Work.hwkey']);

  // Show in Folder asks the OS file manager for that vault (stubbed: no Explorer window in a test).
  await app.evaluate(({ shell }) => {
    const calls: string[] = [];
    (globalThis as unknown as { __shown: string[] }).__shown = calls;
    shell.showItemInFolder = (p: string) => {
      calls.push(p);
    };
  });
  await vaultAction(page, 'Beta', 'Show in Folder');
  await expect
    .poll(() => app!.evaluate(() => (globalThis as unknown as { __shown: string[] }).__shown))
    .toEqual([path.join(vaultsDir, 'Beta.db')]);

  // Delete Beta: no password, but its name must be typed. Cancel first leaves it alone.
  await vaultAction(page, 'Beta', 'Delete…');
  let del = page.getByRole('dialog', { name: 'Delete Beta?' });
  await expect(del.getByText('Copies synced to SFTP, FTP, S3 or a folder are not deleted.')).toBeVisible();
  await del.getByRole('button', { name: 'Cancel' }).click();
  await expect(del).toHaveCount(0);
  expect(vaultFiles()).toContain('Beta.db');

  await vaultAction(page, 'Beta', 'Delete…');
  del = page.getByRole('dialog', { name: 'Delete Beta?' });
  const confirm = del.getByRole('button', { name: 'Delete Vault' });
  await expect(confirm).toBeDisabled();
  await del.getByLabel('Type "Beta" to confirm').fill('Bet');
  await expect(confirm).toBeDisabled();
  await del.getByLabel('Type "Beta" to confirm').fill('Beta');
  await confirm.click();
  await expect(del).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Deleted Beta' })).toBeVisible();
  await expect(page.getByText('You have 1 vault')).toBeVisible();
  expect(vaultFiles()).toEqual(['Alpha Work.db', 'Alpha Work.db.salt']);
  // Recoverable: both files are in the (test) Recycle Bin.
  expect(readdirSync(trashDir).map((f) => f.replace(/^\d+-/, '')).sort()).toEqual(['Beta.db', 'Beta.db.salt']);

  // The renamed vault still opens with its password, under its new name.
  readdirSync(hwkeyDir).forEach((f) => rmSync(path.join(hwkeyDir, f))); // the stand-in isn't a real key
  await page.getByRole('button', { name: /^Alpha Work/ }).click();
  await page.getByPlaceholder('Master password').fill(PASSWORD_A);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle('Vault menu')).toContainText('Alpha Work');

  // Lock with a single vault: "Manage vaults" reaches the picker, and deleting the last vault
  // goes back to the welcome screen.
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await page.getByRole('button', { name: 'Manage vaults' }).click();
  await vaultAction(page, 'Alpha Work', 'Delete…');
  del = page.getByRole('dialog', { name: 'Delete Alpha Work?' });
  await del.getByLabel('Type "Alpha Work" to confirm').fill('Alpha Work');
  await del.getByLabel('Type "Alpha Work" to confirm').press('Enter');
  await expect(page.getByRole('button', { name: 'Create Your First Vault' })).toBeVisible();
  expect(vaultFiles()).toEqual([]);
  expect(existsSync(path.join(trashDir))).toBe(true);
  expect(readdirSync(trashDir)).toHaveLength(4);
});
