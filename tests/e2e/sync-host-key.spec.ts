import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// Vault sync over SFTP checks the server's host key: a sync never prompts and refuses an
// untrusted key, Test Connection asks, and "Always Accept" there lets syncs through.
// Throwaway local SSH server (never a real host) and an isolated profile.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-synchk-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-sync-remote-'));
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

test('SFTP vault sync refuses an untrusted host key until Test Connection trusts it, then syncs into Remote Path', async () => {
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
  await page.getByPlaceholder('My Vault').fill('E2E Sync Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // Settings → Vault Sync → SFTP, pointed at the local test server
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Vault Sync', exact: true }).click();
  await page.getByRole('button', { name: /SFTP\s*Sync via SSH/ }).click();
  await page.getByPlaceholder('server.example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('username').fill(server.username);
  await page.getByPlaceholder('Password (optional if using key)').fill(server.password);
  await page.getByPlaceholder('/home/user/nexus-sync').fill('/backups/nexus');
  // Push uses the stored config, which auto-saves after a debounce. Wait until it holds the
  // whole form (the "Saved" label can be left over from an earlier field's save).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const cfg = (await window.nexus.sync.getConfig()) as {
            backendConfig?: { port?: number; password?: string; remotePath?: string };
          } | null;
          const b = cfg?.backendConfig;
          return b ? `${b.port}|${b.password}|${b.remotePath}` : null;
        }),
      { timeout: 10_000 }
    )
    .toBe(`${server.port}|${server.password}|/backups/nexus`);

  // A sync can't prompt, so the unknown key is refused and nothing is uploaded. The failure
  // shows as an error toast (role=alert), which can be dismissed (#2583).
  const pushButton = page.getByRole('button', { name: 'Push', exact: true });
  const prompt = page.getByRole('button', { name: 'Always Accept' });
  await pushButton.click();
  const failure = page.getByRole('alert').filter({ hasText: /Sync push failed: .*isn't trusted yet/ });
  await expect(failure).toBeVisible({ timeout: 15_000 });
  await expect(prompt).toHaveCount(0);
  expect(readdirSync(remoteDir)).toEqual([]);
  await failure.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(failure).toHaveCount(0);

  // Test Connection asks; Reject fails with the reason shown
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await page.getByRole('button', { name: 'Reject' }).click({ timeout: 15_000 });
  await expect(page.getByText(/Connection failed: .*was not accepted/)).toBeVisible({
    timeout: 15_000,
  });

  // Test Connection again; Always Accept pins the key
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await prompt.click({ timeout: 15_000 });
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 });

  // Now the sync goes through without asking, and says so
  await pushButton.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Sync push completed' })
  ).toBeVisible({ timeout: 15_000 });
  await expect(prompt).toHaveCount(0);
  // ...into the configured Remote Path, which it creates (#2582)
  expect(readdirSync(remoteDir)).toEqual(['backups']);
  const uploaded = readdirSync(path.join(remoteDir, 'backups/nexus'));
  expect(uploaded.some((f) => f.endsWith('.db'))).toBe(true);
  expect(uploaded.some((f) => f.endsWith('.salt'))).toBe(true);
});
