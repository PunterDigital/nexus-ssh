import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// #5610: a hostile SFTP server picks the names of the files it lists. A name with backslashes
// must not turn a download into a write outside the chosen folder, and a download over an
// existing file asks first. Throwaway local server, isolated profile.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-dlnames-'));
const outerDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-dlouter-'));
const localDir = path.join(outerDir, 'inner');
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-dlremote-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
/** On Windows this resolves from `inner` to `outerDir/escaped.cmd`. */
const HOSTILE = 'sub\\..\\..\\escaped.cmd';
const REPORT = 'report.txt';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  mkdirSync(localDir);
  writeFileSync(path.join(remoteDir, REPORT), 'from the server');
  server = await startTestServer({
    root: remoteDir,
    virtualFiles: { [HOSTILE]: Buffer.from('echo pwned\r\n') },
  });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, outerDir, remoteDir])
    rmSync(dir, { recursive: true, force: true });
});

const remoteFile = (page: Page, name: string) =>
  page
    .getByRole('listbox', { name: 'Remote files' })
    .getByRole('option', { name, exact: true });

async function download(page: Page, name: string): Promise<void> {
  await remoteFile(page, name).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Download' }).click();
}

test('SFTP downloads refuse unsafe names and ask before replacing a file', async () => {
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
  const page = await app.firstWindow();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Download Names');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('E2E Hostile Server');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();

  await page
    .getByRole('button', { name: /E2E Hostile Server/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Accept Once' })
    .click({ timeout: 15_000 })
    .catch(() => {});

  await page.getByRole('button', { name: 'Edit local path' }).click();
  const pathInput = page.getByRole('textbox', { name: 'Local path' });
  await pathInput.fill(localDir);
  await pathInput.press('Enter');

  // 1. The backslash name is listed, but downloading it is refused and writes nothing.
  await expect(remoteFile(page, HOSTILE)).toBeVisible({ timeout: 15_000 });
  await download(page, HOSTILE);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Refused to download' })
  ).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'path separator' })
  ).toBeVisible();
  expect(readdirSync(localDir)).toEqual([]);
  expect(readdirSync(outerDir)).toEqual(['inner']);
  expect(existsSync(path.join(outerDir, 'escaped.cmd'))).toBe(false);

  // 2. A file of the same name exists: the download asks. Keep both saves "report (1).txt".
  const mine = path.join(localDir, REPORT);
  writeFileSync(mine, 'my own copy');
  const dialog = page.getByRole('dialog', { name: 'File already exists' });

  await download(page, REPORT);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(REPORT);
  await dialog.getByRole('button', { name: 'Keep both' }).click();
  await expect(dialog).toBeHidden();
  const copy = path.join(localDir, 'report (1).txt');
  await expect
    .poll(() => existsSync(copy) && readFileSync(copy, 'utf8'))
    .toBe('from the server');
  expect(readFileSync(mine, 'utf8')).toBe('my own copy');

  // 3. Skip leaves everything as it was.
  await download(page, REPORT);
  await dialog.getByRole('button', { name: 'Skip' }).click();
  await expect(dialog).toBeHidden();
  expect(readFileSync(mine, 'utf8')).toBe('my own copy');

  // 4. Overwrite replaces it.
  await download(page, REPORT);
  await dialog.getByRole('button', { name: 'Overwrite' }).click();
  await expect.poll(() => readFileSync(mine, 'utf8')).toBe('from the server');
  await expect
    .poll(() => readdirSync(localDir).sort())
    .toEqual(['report (1).txt', REPORT]);
});
