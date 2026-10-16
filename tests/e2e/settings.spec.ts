import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The Settings view on the design system (#2367): section navigation by mouse and keyboard,
// switches and the cursor-style radio group that save at once and are shown again when Settings
// is reopened, the theme picker (a radio group of preview cards that recolours the app), and the
// layout at the minimum window size with the widest sidebar (a 560 px main area).
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-settings-view-'));
const PASSWORD = 'e2e-Settings-View-47!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
const SECTIONS = ['General', 'Appearance', 'Terminal', 'SFTP', 'Vault Sync', 'About'] as const;

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

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Settings View Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
});

const sectionNav = () => page.getByRole('navigation', { name: 'Settings sections' });
const sectionButton = (name: string) => sectionNav().getByRole('button', { name, exact: true });
const sectionHeading = (name: string) =>
  page.locator('main').getByRole('heading', { level: 3, name, exact: true });

async function openSettings(): Promise<void> {
  await page.locator('header').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(sectionNav()).toBeVisible();
}

/** Leave Settings for the Hosts view (unmounts the panel, so reopening reloads every value). */
async function leaveSettings(): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Hosts', exact: true })
    .click();
  await expect(sectionNav()).toBeHidden();
}

async function goTo(name: string): Promise<void> {
  await sectionButton(name).click();
  await expect(sectionHeading(name)).toBeVisible();
}

const vaultSetting = (key: string) => page.evaluate((k) => window.nexus.settings.get(k), key);
const rootColour = (name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('Settings opens on General; sections switch by click and by keyboard', async () => {
  await openSettings();
  await expect(sectionHeading('General')).toBeVisible();
  await expect(sectionButton('General')).toHaveAttribute('aria-current', 'page');

  for (const name of SECTIONS) {
    await goTo(name);
    await expect(sectionButton(name)).toHaveAttribute('aria-current', 'page');
    // Exactly one section is marked current.
    await expect(sectionNav().locator('[aria-current="page"]')).toHaveCount(1);
  }

  // Keyboard: Tab moves along the section list, Enter / Space opens a section.
  await sectionButton('Appearance').focus();
  await page.keyboard.press('Tab');
  await expect(sectionButton('Terminal')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sectionHeading('Terminal')).toBeVisible();
  await expect(sectionButton('Terminal')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Tab');
  await expect(sectionButton('SFTP')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(sectionHeading('SFTP')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(sectionButton('Appearance')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sectionHeading('Appearance')).toBeVisible();

  // Every setting control is named by its row label.
  await goTo('General');
  await expect(page.getByRole('spinbutton', { name: 'Auto-lock timeout' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Clipboard clear timeout' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Check for updates automatically' })).toBeVisible();
  await goTo('Terminal');
  await expect(page.getByRole('combobox', { name: 'Font family' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Scrollback lines' })).toBeVisible();
  await leaveSettings();
});

test('switches save at once and are shown again after reopening Settings', async () => {
  await openSettings();

  // Mouse: SFTP → Show hidden files (off by default).
  await goTo('SFTP');
  const hidden = page.getByRole('switch', { name: 'Show hidden files by default' });
  await expect(hidden).toHaveAttribute('aria-checked', 'false');
  await hidden.click();
  await expect(hidden).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => vaultSetting('showHiddenFiles')).toBe(true);

  // Keyboard: Terminal → Cursor blink (on by default), toggled with Space.
  await goTo('Terminal');
  const blink = page.getByRole('switch', { name: 'Cursor blink' });
  await expect(blink).toHaveAttribute('aria-checked', 'true');
  await blink.focus();
  await page.keyboard.press('Space');
  await expect(blink).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => vaultSetting('cursorBlink')).toBe(false);

  await leaveSettings();
  await openSettings();
  await expect(sectionHeading('General')).toBeVisible();
  await goTo('SFTP');
  await expect(page.getByRole('switch', { name: 'Show hidden files by default' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await goTo('Terminal');
  await expect(page.getByRole('switch', { name: 'Cursor blink' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await leaveSettings();
});

test('cursor style is a segmented radio group; the choice is saved and shown again', async () => {
  await openSettings();
  await goTo('Terminal');
  const cursor = page.getByRole('radiogroup', { name: 'Cursor style' });
  await expect(cursor.getByRole('radio', { name: 'Block' })).toBeChecked();

  await cursor.getByText('Underline', { exact: true }).click();
  await expect(cursor.getByRole('radio', { name: 'Underline' })).toBeChecked();
  await expect(cursor.getByRole('radio', { name: 'Block' })).not.toBeChecked();
  await expect.poll(() => vaultSetting('cursorStyle')).toBe('underline');

  // Arrow keys move the selection (native radios: one tab stop).
  await cursor.getByRole('radio', { name: 'Underline' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cursor.getByRole('radio', { name: 'Bar' })).toBeChecked();
  await expect.poll(() => vaultSetting('cursorStyle')).toBe('bar');

  await leaveSettings();
  await openSettings();
  await goTo('Terminal');
  await expect(
    page.getByRole('radiogroup', { name: 'Cursor style' }).getByRole('radio', { name: 'Bar' }),
  ).toBeChecked();
  await leaveSettings();
});

test('picking a theme card recolours the app; arrow keys move between themes', async () => {
  await openSettings();
  await goTo('Appearance');
  const themes = page.getByRole('radiogroup', { name: 'Theme' });
  await expect(themes.getByRole('radio')).toHaveCount(7);
  await expect(themes.getByRole('radio', { checked: true })).toHaveCount(1);
  await expect(themes.getByRole('radio', { name: 'Dracula' })).toHaveAttribute('aria-checked', 'true');
  const dracula = await rootColour('--color-bg-primary');

  // Mouse
  await themes.getByRole('radio', { name: 'Nord' }).click();
  await expect(themes.getByRole('radio', { name: 'Nord' })).toHaveAttribute('aria-checked', 'true');
  await expect(themes.getByRole('radio', { name: 'Dracula' })).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => rootColour('--color-bg-primary')).toBe('#2e3440'); // Nord's bgPrimary
  expect(dracula).not.toBe('#2e3440');

  // Keyboard: the radio group is one tab stop (the selected card); arrows select the next one.
  await expect(themes.getByRole('radio', { name: 'Nord' })).toHaveAttribute('tabindex', '0');
  await expect(themes.locator('[tabindex="0"]')).toHaveCount(1);
  await themes.getByRole('radio', { name: 'Nord' }).focus();
  await page.keyboard.press('ArrowRight');
  const monokai = themes.getByRole('radio', { name: 'Monokai' });
  await expect(monokai).toHaveAttribute('aria-checked', 'true');
  await expect(monokai).toBeFocused();
  await expect.poll(() => rootColour('--color-bg-primary')).not.toBe('#2e3440');
  await page.keyboard.press('ArrowLeft');
  await expect(themes.getByRole('radio', { name: 'Nord' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(themes.getByRole('radio', { name: 'Tokyo Night' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => window.nexus.appSettings.get('theme'))).toBe('tokyo-night');

  // Back to the default so the layout test below runs on the default theme.
  await page.keyboard.press('Home');
  await expect(themes.getByRole('radio', { name: 'Dracula' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => rootColour('--color-bg-primary')).toBe(dracula);
  await leaveSettings();
});

test('About links open the repository and downloads page in the browser (#2664)', async () => {
  // Record instead of launching a real browser.
  await app!.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] };
    g.__opened = [];
    shell.openExternal = async (url: string) => {
      g.__opened.push(url);
    };
  });
  const opened = () => app!.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened);

  await openSettings();
  await goTo('About');
  await page.getByRole('link', { name: 'GitHub Repository' }).click();
  await page.getByRole('link', { name: 'Website' }).click();
  await expect
    .poll(opened)
    .toEqual(['https://github.com/PunterDigital/nexus-ssh', 'https://punterdigital.github.io/personal-apps/']);
  // The window itself never navigated away.
  await expect(sectionHeading('About')).toBeVisible();

  // Anything off the allow-list is refused by main.
  const refused = await page.evaluate(() =>
    window.nexus.shell.openExternal('https://example.com/').then(
      () => 'opened',
      (err: Error) => err.message,
    ),
  );
  expect(refused).toBe('This link is not allowed');
  expect(await opened()).toHaveLength(2);
  await leaveSettings();
});

test('every section fits the minimum window with the widest sidebar', async () => {
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(900);
  // The widest sidebar leaves the main area its 560 px minimum.
  await page.getByRole('separator', { name: 'Resize sidebar' }).focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => page.locator('main').evaluate((el) => el.clientWidth))
    .toBeLessThan(600);

  await openSettings();
  for (const name of SECTIONS) {
    await goTo(name);
    await page.waitForTimeout(300); // let the layout settle
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > window.innerWidth + 1) out.push(`page scrolls sideways (${doc.scrollWidth})`);
      if (doc.scrollHeight > window.innerHeight + 1) out.push(`page scrolls down (${doc.scrollHeight})`);
      const main = document.querySelector('main')!;
      const box = main.getBoundingClientRect();
      if (main.scrollWidth > main.clientWidth + 1)
        out.push(`main clips content sideways (${main.scrollWidth} > ${main.clientWidth})`);
      for (const el of main.querySelectorAll<HTMLElement>('*')) {
        if (el.matches('input, textarea, select')) continue;
        const ox = getComputedStyle(el).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1)
          out.push(`${el.tagName.toLowerCase()}.${el.className} scrolls sideways`);
      }
      for (const el of main.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [role="radio"], [role="switch"]',
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < box.left - 1 || r.right > box.right + 1)
          out.push(
            `cut off: ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" spans ${Math.round(r.left)}–${Math.round(r.right)}, main ${Math.round(box.left)}–${Math.round(box.right)}`,
          );
      }
      return out;
    });
    expect(problems, `${name} at 900x600`).toEqual([]);
  }

  // The narrow layout stacks each control under its label; the theme grid drops to 2 columns.
  await goTo('Appearance');
  const cards = page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio');
  const [first, second, third] = await Promise.all(
    [0, 1, 2].map((i) => cards.nth(i).evaluate((el) => el.getBoundingClientRect().top)),
  );
  expect(first).toBe(second);
  expect(third).toBeGreaterThan(first);
  await leaveSettings();
});
