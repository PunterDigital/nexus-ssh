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
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// App shell (#2365): nothing clipped or off-screen from the minimum window size up to 4K,
// a resizable + collapsible sidebar that remembers its state, and a session tab strip that
// handles more tabs than fit.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-shell-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-shell-remote-'));
const PASSWORD = 'e2e-Shell-Layout-44!';
const HOST = 'Layout Host'; // + a number: one terminal per host, so one host per session
const SESSIONS = 7;
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

// The second test reuses the first one's vault.
test.describe.configure({ mode: 'serial' });

let server: TestServer;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, remoteDir])
    rmSync(dir, { recursive: true, force: true });
});

function launch(): Promise<ElectronApplication> {
  return electron.launch({
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
}

/** Resize the real window (the OS enforces minWidth / minHeight) and return its outer size. */
async function setWindowSize(
  a: ElectronApplication,
  width: number,
  height: number
): Promise<number[]> {
  return a.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(w, h);
      return win.getSize();
    },
    [width, height]
  );
}

/**
 * Everything in the shell is inside the viewport, the page doesn't scroll, and the main area
 * doesn't clip content sideways.
 */
async function expectNothingOffScreen(page: Page, label: string): Promise<void> {
  // Let a resize settle (ResizeObserver, sidebar width transition).
  await page.waitForTimeout(400);
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 1)
      out.push(`page scrolls sideways (${doc.scrollWidth} > ${vw})`);
    if (doc.scrollHeight > vh + 1)
      out.push(`page scrolls down (${doc.scrollHeight} > ${vh})`);
    const check = (selector: string) => {
      const els = [...document.querySelectorAll<HTMLElement>(selector)];
      if (els.length === 0) out.push(`missing: ${selector}`);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)
          out.push(
            `${selector} "${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 30)}" at ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)} (viewport ${vw}x${vh})`
          );
      }
    };
    check('header');
    check('aside[aria-label="Sidebar"]');
    check('main');
    check('footer');
    check('header button[aria-label="Lock vault"]');
    check('header button[aria-label="Settings"]');
    check('nav[aria-label="Main"] button');
    const main = document.querySelector('main')!;
    if (main.scrollWidth > main.clientWidth + 1)
      out.push(`main clips content sideways (${main.scrollWidth} > ${main.clientWidth})`);
    // Controls cut off by a nested overflow-hidden box (main.scrollWidth can't see those).
    // Strips that scroll sideways on purpose are skipped.
    const mainBox = main.getBoundingClientRect();
    const scrollsSideways = (el: Element) => {
      for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    for (const el of main.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href]'
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || scrollsSideways(el)) continue;
      if (r.right > mainBox.right + 1 || r.left < mainBox.left - 1)
        out.push(
          `control cut off: ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim().slice(0, 30)}" spans ${Math.round(r.left)}–${Math.round(r.right)}, main ${Math.round(mainBox.left)}–${Math.round(mainBox.right)}`
        );
    }
    return { out, vw, vh, mainWidth: main.clientWidth };
  });
  expect(report.out, `${label} (${report.vw}x${report.vh})`).toEqual([]);
}

async function sidebarWidth(page: Page): Promise<number> {
  return page
    .locator('aside[aria-label="Sidebar"]')
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

const VIEWS = ['Hosts', 'SFTP', 'Keychain', 'Snippets'] as const;

async function visitEveryView(page: Page, label: string): Promise<void> {
  for (const view of VIEWS) {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: view, exact: true })
      .click();
    await expectNothingOffScreen(page, `${label}: ${view}`);
  }
  await page.getByTitle('Settings').click();
  await expectNothingOffScreen(page, `${label}: Settings`);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Hosts', exact: true })
    .click();
}

test('the shell fits from the minimum window size to 4K; sidebar resizes, collapses and remembers', async () => {
  app = await launch();
  let page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('Shell Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // The OS stops the window at the minimum size.
  const [minW, minH] = await setWindowSize(app, 400, 300);
  expect(minW).toBeGreaterThanOrEqual(900);
  expect(minH).toBeGreaterThanOrEqual(600);
  await visitEveryView(page, 'minimum window');

  // A maximum-width sidebar at the minimum size still leaves the main area its minimum width.
  const handle = page.getByRole('separator', { name: 'Resize sidebar' });
  await handle.focus();
  await page.keyboard.press('End');
  await expectNothingOffScreen(page, 'minimum window, widest sidebar');
  expect(
    await page.locator('main').evaluate((el) => el.clientWidth)
  ).toBeGreaterThanOrEqual(560);
  await page.keyboard.press('Home');
  await expect.poll(() => sidebarWidth(page)).toBe(176);
  await setWindowSize(app, 1400, 900);

  // Drag the sidebar edge 100 px wider, then nudge it with the keyboard.
  const before = await sidebarWidth(page);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect.poll(() => sidebarWidth(page)).toBe(before + 100);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => sidebarWidth(page)).toBe(before + 100 - 16);
  await expect(handle).toHaveAttribute('aria-valuenow', String(before + 84));
  const savedWidth = before + 84;

  // Collapse to the icon rail: navigation still works from the icons.
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  expect(await sidebarWidth(page)).toBe(48);
  const keychainIcon = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Keychain' });
  await keychainIcon.click();
  await expect(keychainIcon).toHaveAttribute('aria-current', 'page');
  await setWindowSize(app, 400, 300);
  await expectNothingOffScreen(page, 'minimum window, collapsed sidebar');

  // Restart: collapsed state and width are remembered (app settings, outside the vault).
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await setWindowSize(app, 1400, 900);
  await expect.poll(() => sidebarWidth(page)).toBe(savedWidth);
  // Double-click resets the width.
  await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick();
  await expect.poll(() => sidebarWidth(page)).toBe(224);

  // 4K (CSS pixels): emulated, since a real window can't outgrow a CI runner's screen. Last,
  // because the emulation can't be turned off again.
  await page.setViewportSize({ width: 3840, height: 2160 });
  await visitEveryView(page, '4K');
  await app.close();
  app = undefined;
});

test('session tabs: more than fit scroll, the active one stays in view, and the menu lists them all', async () => {
  // Reuses the vault from the first test.
  app = await launch();
  const page = await app.firstWindow();
  await page.getByPlaceholder('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
  await setWindowSize(app, 400, 300);

  for (let i = 1; i <= SESSIONS; i++) {
    await page.getByRole('button', { name: 'New Host' }).click();
    await page.getByPlaceholder('My Server').fill(`${HOST} ${i}`);
    await page.getByPlaceholder('192.168.1.1 or example.com').fill('127.0.0.1');
    await page.getByPlaceholder('22').fill(String(server.port));
    await page.getByPlaceholder('root').fill(server.username);
    await page.getByPlaceholder('Enter password').fill(server.password);
    await page.getByRole('button', { name: 'Create Host' }).click();
    await expect(page.getByText(`${HOST} ${i}`).first()).toBeVisible();
  }

  const tabs = page.getByRole('tablist', { name: 'Open sessions' }).getByRole('tab');
  const hostsNav = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Hosts', exact: true });
  for (let i = 1; i <= SESSIONS; i++) {
    await hostsNav.click();
    // Scoped to main: the header's "Close <host>" buttons match the name too.
    await page
      .locator('main')
      .getByRole('button', { name: `${HOST} ${i}` })
      .first()
      .click();
    if (i === 1)
      await page
        .getByRole('button', { name: 'Always Accept' })
        .click({ timeout: 15_000 });
    await expect(tabs).toHaveCount(i);
  }
  await expect.poll(() => server.openConnections(), { timeout: 30_000 }).toBe(SESSIONS);

  // They don't all fit at the minimum size: scroll controls and the "All sessions" menu appear,
  // and the newest (active) tab is fully visible inside the strip.
  await expect(page.getByRole('button', { name: 'All sessions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scroll tabs left' })).toBeVisible();
  const inStrip = (index: number) =>
    page.evaluate((i) => {
      const strip = document
        .querySelector('[role="tablist"][aria-label="Open sessions"]')!
        .getBoundingClientRect();
      const tab = document
        .querySelectorAll('[role="tablist"][aria-label="Open sessions"] [role="tab"]')
        [i].getBoundingClientRect();
      return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
    }, index);
  await expect(tabs.nth(SESSIONS - 1)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => inStrip(SESSIONS - 1)).toBe(true);
  expect(await inStrip(0)).toBe(false);
  await expectNothingOffScreen(page, `${SESSIONS} tabs at the minimum size`);

  // Pick the first session from the menu: it becomes active and scrolls into view.
  await page.getByRole('button', { name: 'All sessions' }).click();
  await expect(
    page.getByRole('menu', { name: 'All sessions' }).getByRole('menuitem')
  ).toHaveCount(SESSIONS);
  await page
    .getByRole('menu', { name: 'All sessions' })
    .getByRole('menuitem')
    .first()
    .click();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => inStrip(0)).toBe(true);
  await expect(page.getByRole('button', { name: 'Scroll tabs right' })).toBeVisible();

  // Keyboard: arrows move focus, Enter opens the tab, Delete closes the focused session.
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Enter');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await tabs.nth(1).focus();
  await page.keyboard.press('Delete');
  await expect(tabs).toHaveCount(SESSIONS - 1);
  await expect
    .poll(() => server.openConnections(), { timeout: 10_000 })
    .toBe(SESSIONS - 1);

  // Close buttons close the rest; at 4K everything fits and the overflow controls go away.
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expect(page.getByRole('button', { name: 'All sessions' })).toHaveCount(0);
  await expectNothingOffScreen(page, `${SESSIONS - 1} tabs at 4K`);
  for (let left = SESSIONS - 1; left > 0; left--) {
    await page
      .getByRole('button', { name: new RegExp(`^Close ${HOST}`) })
      .first()
      .click();
    await expect(tabs).toHaveCount(left - 1);
  }
  await expect(page.getByText('No open sessions')).toBeVisible();
  await expect.poll(() => server.openConnections(), { timeout: 10_000 }).toBe(0);
});
