import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// #2364: the design-system gallery (#design-system) shows every primitive. Drive the primitives
// with the keyboard like a user would, and check that switching themes changes colours only.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-ds-'));
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: { ...process.env, NEXUS_USE_BUILT_RENDERER: '1', NEXUS_USER_DATA_DIR: userDataDir, NEXUS_DISABLE_IDLE_LOCK: '1' },
  });
  page = await app.firstWindow();
  await page.evaluate(() => (window.location.hash = '#design-system'));
  await expect(page.getByRole('heading', { name: 'Nexus design system' })).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('tabs: arrow keys move the selection and skip disabled tabs', async () => {
  const tablist = page.getByRole('tablist', { name: 'Settings sections' });
  const general = tablist.getByRole('tab', { name: 'General' });
  await general.click();
  await expect(general).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tablist.getByRole('tab', { name: 'Terminal' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveText('Terminal settings panel.');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // Beta is disabled: wraps to General
  await expect(general).toBeFocused();
  await page.keyboard.press('End');
  await expect(tablist.getByRole('tab', { name: 'Vault Sync' })).toHaveAttribute('aria-selected', 'true');
});

test('menu: keyboard opens it, arrows move, Enter selects, Escape returns focus', async () => {
  const trigger = page.getByRole('button', { name: 'Actions', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Host actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Connect/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // Edit is disabled: skipped
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Last action' })).toHaveText('Last action: sftp');
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('dialog: focus moves in and is trapped, Escape closes it and focus returns', async () => {
  const opener = page.getByRole('button', { name: 'Delete host…' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Delete production-web-01?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  // Close, Cancel, Delete: Tab cycles inside the dialog.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('field: hint and error are announced with the control', async () => {
  const host = page.getByRole('textbox', { name: 'Hostname' });
  await expect(host).toHaveAccessibleDescription('IP address or DNS name.');
  await expect(host).toHaveAttribute('required', '');
  const port = page.getByRole('textbox', { name: 'Port' });
  await expect(port).toHaveAttribute('aria-invalid', 'true');
  await expect(port).toHaveAccessibleDescription('Port must be between 1 and 65535.');
});

test('toggle icon button reports its pressed state', async () => {
  const toggle = page.getByRole('button', { name: 'Show hidden files' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('themes change colours only, and button text stays readable', async () => {
  const button = page.getByRole('button', { name: 'New Host' }).first();
  const measure = () =>
    button.evaluate((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { size: [r.width, r.height], font: s.fontSize, padding: s.padding, radius: s.borderRadius, bg: s.backgroundColor, fg: s.color };
    });
  const contrast = (a: string, b: string) => {
    const lum = (c: string) => {
      const [r, g, b2] = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const theme = page.getByRole('combobox', { name: 'Theme' });
  await theme.selectOption('tokyo-night');
  await page.waitForTimeout(400); // let the colour transition finish
  const tokyo = await measure();
  await theme.selectOption('dracula');
  await expect.poll(async () => (await measure()).bg).not.toBe(tokyo.bg);
  await page.waitForTimeout(400);
  const dracula = await measure();

  expect(dracula.size).toEqual(tokyo.size);
  expect(dracula.font).toBe(tokyo.font);
  expect(dracula.padding).toBe(tokyo.padding);
  expect(dracula.radius).toBe(tokyo.radius);
  expect(dracula.bg).not.toBe(tokyo.bg);
  expect(contrast(tokyo.fg, tokyo.bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(dracula.fg, dracula.bg)).toBeGreaterThanOrEqual(4.5);
});

test('switch, checkbox and radio group work from the keyboard (#2367)', async () => {
  const autoSync = page.getByRole('switch', { name: 'Auto-sync' });
  await expect(autoSync).toHaveAttribute('aria-checked', 'true');
  await expect(autoSync).toHaveAccessibleDescription('Switch: applies immediately.');
  await autoSync.focus();
  await page.keyboard.press('Space');
  await expect(autoSync).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'Disabled switch' })).toBeDisabled();

  const keepTimes = page.getByRole('checkbox', { name: /Preserve timestamps/ });
  await keepTimes.click();
  await expect(keepTimes).toBeChecked();

  const cursor = page.getByRole('radiogroup', { name: 'Cursor style' });
  await cursor.getByRole('radio', { name: 'Block' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cursor.getByRole('radio', { name: 'Underline' })).toBeChecked();

  const conflict = page.getByRole('radiogroup', { name: 'Conflict resolution' });
  await conflict.getByRole('radio', { name: /Keep local/ }).click();
  await expect(conflict.getByRole('radio', { name: /Keep local/ })).toBeChecked();
  await expect(conflict.getByRole('radio', { name: /Keep remote/ })).toBeDisabled();
});
