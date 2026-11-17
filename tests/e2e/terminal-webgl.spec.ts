import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// #5004: with GPU acceleration on (the default), Electron 45 drew every glyph at 10 px in
// cells sized for the real font. The WebGL addon sets its glyph font with a leading space,
// which this Chromium refuses ("10px sans-serif" stays). The test records every canvas font
// the renderer asks for and what the canvas actually took, at the default size and after a
// live change to 24 px.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-webgl-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-webgl-remote-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, remoteDir]) rmSync(dir, { recursive: true, force: true });
});

interface FontSet {
  asked: string;
  got: string;
}

/** Font sets that asked for `px` px but ended up on another size (the bug: "10px sans-serif"). */
const fontSets = () => page.evaluate(() => (window as unknown as { __fontSets: FontSet[] }).__fontSets.slice());

const wrongFonts = (sets: FontSet[], px: number) =>
  sets.filter((s) => new RegExp(`\\b${px}px\\b`).test(s.asked) && !new RegExp(`\\b${px}px\\b`).test(s.got));

test('the WebGL renderer draws glyphs at the terminal font size', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: { ...process.env, NEXUS_USE_BUILT_RENDERER: '1', NEXUS_USER_DATA_DIR: userDataDir, NEXUS_DISABLE_IDLE_LOCK: '1' },
  });
  // Record canvas font sets before any app code runs (the app's own fix wraps this one).
  await app.context().addInitScript(() => {
    const sets: Array<{ asked: string; got: string }> = [];
    (window as unknown as { __fontSets: typeof sets }).__fontSets = sets;
    for (const proto of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
      const d = Object.getOwnPropertyDescriptor(proto, 'font')!;
      Object.defineProperty(proto, 'font', {
        configurable: true,
        get(this: CanvasRenderingContext2D) {
          return d.get!.call(this);
        },
        set(this: CanvasRenderingContext2D, value: string) {
          d.set!.call(this, value);
          if (sets.length < 500) sets.push({ asked: String(value), got: d.get!.call(this) });
        },
      });
    }
  });
  page = await app.firstWindow();
  await page.reload();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E WebGL');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Hosts', exact: true }).click();
  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('E2E WebGL Host');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();
  await page.getByRole('button', { name: /E2E WebGL Host/ }).first().click();
  await page.getByRole('button', { name: 'Accept Once' }).click({ timeout: 5_000 }).catch(() => {});

  // GPU acceleration is on by default: the terminal is drawn on canvases, not DOM rows.
  await expect.poll(() => page.locator('.xterm canvas').count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await fontSets()).filter((s) => /\b14px\b/.test(s.asked)).length).toBeGreaterThan(0);
  expect(await page.locator('.xterm-rows').count()).toBe(0);
  // Some glyphs were rasterised at 14 px, and none fell back to the canvas default.
  await page.locator('.xterm').first().click();
  await page.keyboard.type('echo webgl-glyphs');
  await page.keyboard.press('Enter');
  await expect.poll(async () => wrongFonts(await fontSets(), 14)).toEqual([]);
  expect((await fontSets()).filter((s) => s.got === '10px sans-serif')).toEqual([]);

  // A live change to 24 px rebuilds the glyph atlas at 24 px.
  await page.evaluate(() => window.nexus.settings.set('terminalFontSize', 24));
  await expect.poll(async () => (await fontSets()).filter((s) => /\b24px\b/.test(s.got)).length).toBeGreaterThan(0);
  await page.keyboard.type('echo bigger');
  await page.keyboard.press('Enter');
  await expect.poll(async () => wrongFonts(await fontSets(), 24)).toEqual([]);
  expect((await fontSets()).filter((s) => s.got === '10px sans-serif')).toEqual([]);
});
