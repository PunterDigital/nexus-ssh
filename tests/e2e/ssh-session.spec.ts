import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// The core flow against a throwaway local SSH/SFTP server (never a real host), with an
// isolated profile: add a host, run a command in a terminal, then download a file over SFTP.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-ssh-'));
const localDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-local-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-remote-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const FILE_NAME = 'from-server.bin';
const MARKER = 'nexus-e2e-hello';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;

const sha = (file: string) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

test.beforeAll(async () => {
  writeFileSync(path.join(remoteDir, FILE_NAME), randomBytes(512 * 1024));
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, localDir, remoteDir])
    rmSync(dir, { recursive: true, force: true });
});

test('add a host, run a command in the terminal, then download a file over SFTP', async () => {
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
  // xterm's WebGL renderer draws to a canvas. Hide WebGL2 (Chromium switches like
  // --disable-webgl don't reach Electron's renderer) so xterm falls back to its DOM renderer,
  // whose rows the test can read, then reload so the script applies to the first window.
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

  // Fresh vault
  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E SSH Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // Host pointing at the local test server
  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('E2E Test Server');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();

  // Terminal: connect (trust the throwaway host key once if asked), run a command
  await page
    .getByRole('button', { name: /E2E Test Server/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Accept Once' })
    .click({ timeout: 5_000 })
    .catch(() => {});
  const rows = page.locator('.xterm-rows');
  await expect(rows).toContainText('nexus-test-shell$', { timeout: 30_000 });
  await page.locator('.xterm').first().click();
  await page.keyboard.type(`echo ${MARKER}`);
  await page.keyboard.press('Enter');
  // The command line itself, then the output on a line of its own.
  await expect(
    rows.locator('div').filter({ hasText: new RegExp(`^\\s*${MARKER}\\s*$`) })
  ).toHaveCount(1);
  expect(server.commands).toContain(`echo ${MARKER}`);

  // SFTP: open the same host, point the local pane at a temp dir, download from the remote pane
  // The terminal's tab is also a button named after the host; the host card shows the address.
  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await page
    .getByRole('button', { name: /E2E Test Server/ })
    .filter({ hasText: server.host })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Accept Once' })
    .click({ timeout: 15_000 })
    .catch(() => {});

  // Click the empty right-hand end: the breadcrumb's segments are buttons that navigate instead.
  const localPath = page.getByTitle('Click to edit path').first();
  const box = (await localPath.boundingBox())!;
  await localPath.click({ position: { x: box.width - 4, y: box.height / 2 } });
  const pathInput = page.locator('input.font-mono').first();
  await pathInput.fill(localDir);
  await pathInput.press('Enter');

  // The file only exists on the server, so the only match is in the remote pane.
  await page.getByText(FILE_NAME, { exact: true }).first().click({ button: 'right' });
  await page.getByText('Download', { exact: true }).click();

  const downloaded = path.join(localDir, FILE_NAME);
  await expect(page.getByRole('button', { name: 'Clear completed' })).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(() => existsSync(downloaded)).toBe(true);
  expect(sha(downloaded)).toBe(sha(path.join(remoteDir, FILE_NAME)));
  // The local pane refreshes and lists the new file too.
  await expect(page.getByText(FILE_NAME, { exact: true })).toHaveCount(2);
});
