import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// Drives the real app against a throwaway local SSH/SFTP server (never a real host),
// with an isolated profile so a real vault is never touched.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-sftp-'));
const localDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-local-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-remote-'));
const PASSWORD = 'e2e-Correct-Horse-42!';
const FILE_NAME = 'payload.bin';
const FILE_SIZE = 4 * 1024 * 1024;
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const remoteSize = () => {
  const f = path.join(remoteDir, FILE_NAME);
  return existsSync(f) ? statSync(f).size : 0;
};

test.beforeAll(async () => {
  writeFileSync(path.join(localDir, FILE_NAME), randomBytes(FILE_SIZE));
  // Slow each SFTP write so the upload runs long enough to pause mid-way.
  server = await startTestServer({ root: remoteDir, writeDelayMs: 25 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, localDir, remoteDir]) rmSync(dir, { recursive: true, force: true });
});

test('SFTP upload can be paused and resumed, and the file arrives intact', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: { ...process.env, NEXUS_USE_BUILT_RENDERER: '1', NEXUS_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();

  // Fresh vault
  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E SFTP Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // Host pointing at the local test server
  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('E2E Test Server');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();

  // Open SFTP; trust the throwaway host key on first use
  await page.getByRole('button', { name: /E2E Test Server/ }).first().click();
  const acceptOnce = page.getByRole('button', { name: 'Accept Once' });
  await acceptOnce.click({ timeout: 15_000 }).catch(() => {});

  // Point the local pane at the temp dir and upload the file from its context menu
  const localPath = page.getByTitle('Click to edit path').first();
  await localPath.click();
  const pathInput = page.locator('input.font-mono').first();
  await pathInput.fill(localDir);
  await pathInput.press('Enter');
  await page.getByText(FILE_NAME, { exact: true }).first().click({ button: 'right' });
  await page.getByText('Upload', { exact: true }).click();

  // Pause once bytes are flowing
  await expect.poll(remoteSize, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.getByTitle('Pause').click();
  await expect(page.getByTitle('Resume')).toBeVisible();

  await page.waitForTimeout(500); // in-flight writes land
  const sizeAtPause = remoteSize();
  await page.waitForTimeout(1500);
  expect(remoteSize()).toBe(sizeAtPause);
  expect(sizeAtPause).toBeLessThan(FILE_SIZE);

  // Resume and finish
  await page.getByTitle('Resume').click();
  await expect(page.getByTitle('Pause')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear completed' })).toBeVisible({ timeout: 60_000 });
  expect(sha(path.join(remoteDir, FILE_NAME))).toBe(sha(path.join(localDir, FILE_NAME)));
});
