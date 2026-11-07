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

// #4322: a terminal whose connection drops opens a "Connection closed" dialog and reconnects
// with backoff (1 s, 2 s, 4 s) in the same tab; it gives up after 3 attempts; typing `exit`
// closes the session without a dialog. Throwaway SSH server and an isolated profile only.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-reconnect-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-reconnect-remote-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
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

async function runCommand(page: Page, command: string): Promise<void> {
  await page.locator('.xterm').first().click({ position: { x: 40, y: 40 } });
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

test('a dropped connection reconnects in the same tab, gives up after 3 attempts, and exit closes quietly', async () => {
  test.setTimeout(180_000);
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
  // Hide WebGL2 so xterm uses its DOM renderer, whose rows the test can read (see ssh-session.spec.ts).
  await app.context().addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type === 'webgl2' ? null : Reflect.apply(getContext, this, [type, ...rest]);
    } as typeof getContext;
  });
  const page = await app.firstWindow();
  await page.reload();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Reconnect Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('Flaky Server');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();

  // Connect and pin the key, so reconnects don't ask about it again.
  await page.getByRole('button', { name: /Flaky Server/ }).first().click();
  await page.getByRole('button', { name: 'Always Accept' }).click({ timeout: 15_000 });
  const rows = page.locator('.xterm-rows');
  await expect(rows).toContainText('nexus-test-shell$', { timeout: 30_000 });
  await runCommand(page, 'echo before-drop');
  await expect.poll(() => server.commands).toContain('echo before-drop');

  const dialog = page.getByRole('dialog', { name: 'Connection closed' });
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(1);

  // 1. Drop: the dialog counts down, attempt 1 connects on its own, same tab, output kept.
  expect(server.openConnections()).toBe(1);
  server.dropConnections();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText('The connection to Flaky Server was lost.');
  await expect(dialog).toContainText(/Reconnecting( in \d s)? \(attempt 1 of 3\)/);
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(rows).toContainText('--- Connection lost:');
  await expect(rows).toContainText('--- Reconnected ---');
  await expect(rows).toContainText('before-drop');
  await expect(tabs).toHaveCount(1);
  await expect.poll(() => server.openConnections()).toBe(1);
  await runCommand(page, 'echo after-reconnect');
  await expect.poll(() => server.commands).toContain('echo after-reconnect');

  // 2. "Reconnect now" skips the countdown.
  server.dropConnections();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Reconnect now' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => server.openConnections()).toBe(1);

  // 3. The host stays down: 3 attempts (1 s + 2 s + 4 s), then it gives up. "Try again" works
  //    once the host is back.
  server.refuseLogins(true);
  server.dropConnections();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText(/attempt 2 of 3/, { timeout: 15_000 });
  await expect(dialog).toContainText('Couldn’t reconnect after 3 attempts.', { timeout: 30_000 });
  await expect(dialog).toContainText(/Reason: .*authentication/i);
  await expect(dialog.getByRole('button', { name: 'Close tab' })).toBeVisible();
  server.refuseLogins(false);
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => server.openConnections()).toBe(1);
  await runCommand(page, 'echo after-try-again');
  await expect.poll(() => server.commands).toContain('echo after-try-again');

  // 4. Stop retrying, then close the dialog: the tab stays with its output.
  server.dropConnections();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Stop retrying' }).click();
  await expect(dialog).toContainText('Stopped reconnecting.');
  await page.waitForTimeout(2_000);
  expect(server.openConnections()).toBe(0);
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // 5. Typing `exit` ends the shell on purpose: a closed line, no dialog, no reconnect.
  await runCommand(page, 'exit');
  await expect(rows).toContainText('--- Connection closed ---', { timeout: 10_000 });
  await page.waitForTimeout(3_000);
  await expect(dialog).toBeHidden();
  expect(server.openConnections()).toBe(0);
  await expect(tabs).toHaveCount(1);

  // The closed tab still shows its output after a view switch.
  await page.getByRole('button', { name: 'Hosts', exact: true }).click();
  await page.getByRole('tab').first().click();
  await expect(rows).toContainText('--- Connection closed ---', { timeout: 10_000 });
  await expect(rows).toContainText('after-try-again');
});
