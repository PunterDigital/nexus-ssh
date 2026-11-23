import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// #5611: a pull checks the synced vault before it replaces the local one. Garbage and an
// older copy put in the sync location are refused and the local vault stays as it was; a
// genuine copy is swapped in and the old files are kept as .bak. Real SQLCipher vaults, a
// temp folder as the backend, an isolated profile.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-pull-'));
const syncDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-pull-remote-'));
const asideDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-pull-aside-'));
const PASSWORD = 'e2e-Pull-Check-57!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let app: ElectronApplication | undefined;

// The FTPS form check reuses the first test's (unlocked) app.
test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await app?.close().catch(() => {});
  for (const dir of [userDataDir, syncDir, asideDir])
    rmSync(dir, { recursive: true, force: true });
});

const launch = () =>
  electron.launch({
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

const remoteFile = (ext: '.db' | '.db.salt') => {
  const name = readdirSync(syncDir).find((f) => f.endsWith('.db'));
  if (!name) throw new Error('no vault in the sync folder');
  return path.join(syncDir, ext === '.db' ? name : name + '.salt');
};

async function openVaultSync(p: Page): Promise<void> {
  await p
    .locator('header')
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  const section = p
    .getByRole('tab', { name: 'Vault Sync', exact: true })
    .or(p.getByRole('button', { name: 'Vault Sync', exact: true }));
  await section.first().click();
  await expect(p.getByRole('combobox', { name: 'Backend' })).toBeVisible();
}

async function openHosts(p: Page): Promise<void> {
  await p
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Hosts', exact: true })
    .click();
}

async function addHost(p: Page, label: string): Promise<void> {
  await openHosts(p);
  await p.getByRole('button', { name: 'New Host' }).click();
  await p.getByPlaceholder('My Server').fill(label);
  await p.getByPlaceholder('192.168.1.1 or example.com').fill('192.0.2.10');
  await p.getByPlaceholder('root').fill('tester');
  await p.getByRole('button', { name: 'Create Host' }).click();
  await expect(hostCard(p, label)).toBeVisible();
}

const hostCard = (p: Page, label: string) =>
  p.getByRole('button', { name: new RegExp(label) }).first();

/** The toast a manual push or pull leaves (status on success, alert on failure). */
const syncToasts = (p: Page) =>
  p
    .getByRole('status')
    .or(p.getByRole('alert'))
    .filter({ hasText: /Sync (push|pull) (completed|failed)/ });

async function sync(p: Page, direction: 'Push' | 'Pull'): Promise<void> {
  await openVaultSync(p);
  // The previous sync's toast stays for 5 s: let it go, so the next check sees this sync's.
  await expect(syncToasts(p)).toHaveCount(0, { timeout: 10_000 });
  await p.getByRole('button', { name: direction, exact: true }).click();
}

const pushed = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Sync push completed' })).toBeVisible({
    timeout: 15_000,
  });

test('a pull refuses garbage and an older copy, and swaps in a genuine one with a backup', async () => {
  app = await launch();
  let page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Pull Check');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // Folder backend, no automatic syncs (lock / launch) so only the test's pushes and pulls run.
  await openVaultSync(page);
  await page.getByRole('combobox', { name: 'Backend' }).selectOption('filesystem');
  await page.getByRole('textbox', { name: 'Directory path' }).fill(syncDir);
  for (const name of ['Sync on vault lock', 'Sync on app launch']) {
    const sw = page.getByRole('switch', { name });
    if ((await sw.getAttribute('aria-checked')) === 'true') await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
  }

  await addHost(page, 'First Host');
  await sync(page, 'Push');
  await pushed(page);
  // Keep generation 1 aside: the "older copy" for later.
  copyFileSync(remoteFile('.db'), path.join(asideDir, 'gen1.db'));
  copyFileSync(remoteFile('.db.salt'), path.join(asideDir, 'gen1.db.salt'));

  await addHost(page, 'Second Host');
  await sync(page, 'Push');
  await pushed(page);
  copyFileSync(remoteFile('.db'), path.join(asideDir, 'gen2.db'));

  // 1. Garbage in the sync location: refused, the vault keeps both hosts.
  writeFileSync(remoteFile('.db'), 'this is not a vault');
  await sync(page, 'Pull');
  await expect(
    page.getByRole('alert').filter({ hasText: "doesn't open with this vault's password" })
  ).toBeVisible({
    timeout: 30_000,
  });
  await openHosts(page);
  await expect(hostCard(page, 'First Host')).toBeVisible();
  await expect(hostCard(page, 'Second Host')).toBeVisible();

  // 2. The older genuine copy put back: refused as older.
  copyFileSync(path.join(asideDir, 'gen1.db'), remoteFile('.db'));
  await sync(page, 'Pull');
  await expect(page.getByRole('alert').filter({ hasText: 'older copy' })).toBeVisible({
    timeout: 30_000,
  });
  await openHosts(page);
  await expect(hostCard(page, 'Second Host')).toBeVisible();

  // 3. A genuine copy at the same generation (as another device would leave it), after a
  //    restart so the app has no record of the last sync: swapped in, with a backup.
  copyFileSync(path.join(asideDir, 'gen2.db'), remoteFile('.db'));
  await addHost(page, 'Unsynced Host'); // local change the pull will replace
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(hostCard(page, 'Unsynced Host')).toBeVisible({ timeout: 30_000 });

  await sync(page, 'Pull');
  await expect(
    page.getByRole('status').filter({ hasText: 'Sync pull completed' })
  ).toBeVisible({ timeout: 30_000 });
  await openHosts(page);
  await expect(hostCard(page, 'Second Host')).toBeVisible();
  await expect(page.getByRole('button', { name: /Unsynced Host/ })).toHaveCount(0);
  const vaultDir = path.join(userDataDir, 'vaults');
  const files = readdirSync(vaultDir);
  expect(files.some((f) => f.endsWith('.db.bak'))).toBe(true);
  expect(files.some((f) => f.endsWith('.db.salt.bak'))).toBe(true);
  expect(files.filter((f) => f.startsWith('.sync_tmp_'))).toEqual([]);

  // The pulled vault still opens after a restart.
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(hostCard(page, 'Second Host')).toBeVisible({ timeout: 30_000 });
  expect(existsSync(vaultDir)).toBe(true);
});

test('a new FTP backend starts on FTPS; plain FTP shows a warning', async () => {
  const page = await app!.firstWindow();
  await openVaultSync(page);
  await page.getByRole('combobox', { name: 'Backend' }).selectOption('ftp');
  const ftps = page.getByRole('switch', { name: 'Use FTPS (TLS)' });
  const warning = page
    .getByRole('note')
    .filter({ hasText: 'Plain FTP sends your FTP password' });
  await expect(ftps).toHaveAttribute('aria-checked', 'true');
  await expect(warning).toHaveCount(0);
  await ftps.click();
  await expect(ftps).toHaveAttribute('aria-checked', 'false');
  await expect(warning).toBeVisible();
});
