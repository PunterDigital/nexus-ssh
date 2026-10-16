import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Host and group forms on the design system (#2366 part 2): inline validation that blocks the
// save, create, edit, and a group whose defaults the host form shows as inherited. Runs at the
// minimum window size, where the dialog body scrolls and its footer must stay on screen.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-hostform-'));
const PASSWORD = 'e2e-Host-Form-46!';
const HOST = 'Form Host';
const RENAMED = 'Form Host Renamed';
const GROUP = 'E2E Group';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

// One app and vault for the whole file; each test builds on the previous one.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
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
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Host Form Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
});

const main = () => page.locator('main');

async function openNewHost(): Promise<Locator> {
  await page.getByRole('button', { name: 'New Host' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New Host' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The dialog fits in the window and its footer (primary action) is on screen. */
async function expectDialogFits(dialog: Locator, primary: string): Promise<void> {
  await expect(dialog.getByRole('button', { name: primary })).toBeInViewport();
  const fits = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  });
  expect(fits).toBe(true);
}

test('submitting an empty New Host form shows the errors and creates nothing', async () => {
  const dialog = await openNewHost();
  await expectDialogFits(dialog, 'Create Host');

  await dialog.getByRole('button', { name: 'Create Host' }).click();
  await expect(dialog.getByText('Hostname is required')).toBeVisible();
  await expect(dialog.getByText('Label is required')).toBeVisible();
  // Errors are wired to the fields; the first invalid one gets focus.
  await expect(dialog.getByPlaceholder('192.168.1.1 or example.com')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByPlaceholder('My Server')).toBeFocused();
  await expect(dialog).toBeVisible();

  // Typing in a field clears its error.
  await dialog.getByPlaceholder('192.168.1.1 or example.com').fill('127.0.0.1');
  await expect(dialog.getByText('Hostname is required')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('No connections yet')).toBeVisible();

  // Reopening starts from an empty form.
  const again = await openNewHost();
  await expect(again.getByPlaceholder('192.168.1.1 or example.com')).toHaveValue('');
  await again.getByRole('button', { name: 'Cancel' }).click();
});

test('an invalid port shows the port error; fixing it creates the host', async () => {
  const dialog = await openNewHost();
  await dialog.getByPlaceholder('My Server').fill(HOST);
  await dialog.getByPlaceholder('192.168.1.1 or example.com').fill('127.0.0.1');
  await dialog.getByPlaceholder('root').fill('e2e');
  const port = dialog.getByPlaceholder('22');
  await port.fill('70000');
  // Enter in a field submits the form
  await port.press('Enter');
  await expect(dialog.getByText('Port must be between 1 and 65535')).toBeVisible();
  await expect(port).toHaveAttribute('aria-invalid', 'true');
  await expect(port).toBeFocused();
  await expect(dialog).toBeVisible();

  await port.fill('2200');
  await dialog.getByRole('button', { name: 'Create Host' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main().getByText(HOST, { exact: true })).toBeVisible();
  await expect(main().getByText('127.0.0.1').first()).toBeVisible();
});

test('editing the host and saving changes its label', async () => {
  await main().getByText(HOST, { exact: true }).click({ button: 'right' });
  // Right-click opens the form directly, or a context menu with Edit in it.
  const dialog = page.getByRole('dialog', { name: `Edit ${HOST}` });
  const menu = page.getByRole('menu');
  await expect(dialog.or(menu)).toBeVisible();
  if (await menu.isVisible()) await menu.getByRole('menuitem', { name: /^Edit/ }).click();
  await expect(dialog).toBeVisible();
  await expectDialogFits(dialog, 'Save Changes');

  const label = dialog.getByPlaceholder('My Server');
  await expect(label).toHaveValue(HOST);
  await expect(dialog.getByPlaceholder('22')).toHaveValue('2200');

  // Advanced settings expand inside the scrolling body; the footer stays visible.
  await dialog.getByRole('button', { name: 'Advanced' }).click();
  await expect(dialog.getByLabel('Keepalive interval')).toHaveValue('60');
  await expectDialogFits(dialog, 'Save Changes');

  await label.fill('');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(dialog.getByText('Label is required')).toBeVisible();

  await label.fill(RENAMED);
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main().getByText(RENAMED, { exact: true })).toBeVisible();
  await expect(main().getByText(HOST, { exact: true })).toHaveCount(0);
});

test('a new group shows in the hosts view and its defaults are inherited by new hosts', async () => {
  await page.getByRole('button', { name: 'New Group' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New Group' });
  await expect(dialog).toBeVisible();

  // Validation: name required, port range
  await dialog.getByLabel('Default port').fill('0');
  await dialog.getByRole('button', { name: 'Create Group' }).click();
  await expect(dialog.getByText('Name is required')).toBeVisible();
  await expect(dialog.getByText('Port must be between 1 and 65535')).toBeVisible();

  await dialog.getByPlaceholder('Production Servers').fill(GROUP);
  await dialog.getByLabel('Default port').fill('2222');
  await dialog.getByLabel('Default username').fill('deploy');
  await dialog.getByRole('button', { name: 'Create Group' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Group "${GROUP}" created` })).toBeVisible();
  await expect(main().getByText(GROUP).first()).toBeVisible();

  // The host form offers the group and shows what a host inherits from it.
  const hostDialog = await openNewHost();
  await hostDialog.getByLabel('Group').selectOption({ label: GROUP });
  await expect(hostDialog.getByText(`Inherited from ${GROUP}`)).toBeVisible();
  await expect(hostDialog.getByLabel('Username')).toHaveAttribute('placeholder', 'deploy');
  await expect(hostDialog.getByLabel('Port')).toHaveAttribute('placeholder', '2222');

  // Username isn't required when the group supplies one.
  await hostDialog.getByPlaceholder('My Server').fill('Grouped Host');
  await hostDialog.getByPlaceholder('192.168.1.1 or example.com').fill('10.0.0.5');
  await hostDialog.getByRole('button', { name: 'Create Host' }).click();
  await expect(hostDialog).toHaveCount(0);
  await expect(main().getByText('Grouped Host', { exact: true })).toBeVisible();
});
