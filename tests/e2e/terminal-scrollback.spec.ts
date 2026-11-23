import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// #5663: leaving the terminal view unmounted every xterm, and coming back rebuilt it and
// replayed the session's whole history from main (which grew without limit). Now the
// terminals stay mounted while another view shows, and main keeps a bounded buffer. Also:
// a multi-byte character split across two packets used to turn into U+FFFD.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-scrollback-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-scrollback-remote-'));
const PASSWORD = 'e2e-Scrollback-63!';
const HOST = 'Scrollback Server';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, remoteDir]) rmSync(dir, { recursive: true, force: true });
});

test('after a big output, the terminal survives a trip to SFTP and back without a rebuild; split UTF-8 renders whole', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
  // DOM renderer, so the rows can be read (see ssh-session.spec.ts).
  await app.context().addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      return type === 'webgl2' ? null : Reflect.apply(getContext, this, [type, ...rest]);
    } as typeof getContext;
  });
  const page = await app.firstWindow();
  await page.reload();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Scrollback');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill(HOST);
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();

  await page.getByRole('button', { name: new RegExp(HOST) }).first().click();
  await page
    .getByRole('button', { name: 'Accept Once' })
    .click({ timeout: 5_000 })
    .catch(() => {});
  const rows = page.locator('.xterm-rows');
  await expect(rows).toContainText('nexus-test-shell$', { timeout: 30_000 });

  // A split UTF-8 line first (it is still on screen at the end of the flood's scrollback).
  await page.locator('.xterm').first().click();
  await page.keyboard.type('utf8split');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('split: café ✓ 🎉 end', { timeout: 10_000 });
  expect(await rows.innerText()).not.toContain('�');

  // 8 MB of output.
  await page.keyboard.type('flood 8');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText(/flood done \d+/, { timeout: 60_000 });
  const lastLine = (await rows.innerText()).match(/flood done \d+/)![0];

  // Mark the xterm: if the trip rebuilds it, the mark is gone.
  await page.locator('.xterm').first().evaluate((el) => el.setAttribute('data-e2e-mark', '1'));

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'SFTP', exact: true })
    .click();
  await expect(page.getByRole('button', { name: new RegExp(HOST) }).first()).toBeVisible();

  const started = Date.now();
  await page
    .getByRole('tablist', { name: 'Open sessions' })
    .getByRole('tab', { name: new RegExp(HOST) })
    .click();
  await expect(rows.filter({ hasText: lastLine })).toBeVisible({ timeout: 30_000 });
  const restoreMs = Date.now() - started;
  console.log(`E2E terminal restore after SFTP: ${restoreMs} ms`);

  await expect(page.locator('.xterm[data-e2e-mark="1"]')).toHaveCount(1);
  expect(restoreMs).toBeLessThan(1_000); // ~200 ms target; CI runners are slower than the PR's numbers
  // Still a live terminal.
  await page.locator('.xterm').first().click();
  await page.keyboard.type('echo still-here');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('still-here');
});
