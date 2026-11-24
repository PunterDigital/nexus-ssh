import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';
import { startFtpTestServer, type FtpTestServer } from '../fixtures/ftp-server';

// #5885: a hardware-key (passwordless) vault has no .salt, and v0.5.2 failed every push with
// "ENOENT … Main Vault.db.salt". The push must upload the .db alone, over FTP and SFTP, and a
// pull must say plainly why it can't run. Throwaway local servers, isolated profile; the
// hardware-key ceremony is replaced by a fixed PRF output (as in hardware-key.spec.ts).
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-nosalt-'));
const ftpDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-nosalt-ftp-'));
const sftpDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-nosalt-sftp-'));
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
const PRF = Buffer.alloc(32, 7).toString('base64');
const CREDENTIAL = {
  credentialId: 'e2e-credential',
  prfSalt: Buffer.alloc(32, 1).toString('base64'),
  rpId: 'localhost',
  userHandle: 'e2e-user',
};
const FTP_CREDS = { username: 'syncer', password: 'ftp-pass-5885' };

let ftp: FtpTestServer;
let ssh: TestServer;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  ftp = await startFtpTestServer({ root: ftpDir, ...FTP_CREDS });
  ssh = await startTestServer({ root: sftpDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await ftp?.close();
  await ssh?.close();
  for (const dir of [userDataDir, ftpDir, sftpDir]) rmSync(dir, { recursive: true, force: true });
});

type SyncApi = {
  configure(c: unknown): Promise<unknown>;
  push(): Promise<unknown>;
  pull(): Promise<unknown>;
  testConnection(c: unknown): Promise<boolean>;
};
const sync = (page: Page) => ({
  configure: (backendConfig: Record<string, unknown>) =>
    page.evaluate(
      (cfg) =>
        (window as unknown as { nexus: { sync: SyncApi } }).nexus.sync.configure({
          backendType: cfg.type,
          backendConfig: cfg,
          syncOnLock: false,
          syncOnLaunch: false,
          syncInterval: 0,
        }),
      backendConfig,
    ),
  run: (what: 'push' | 'pull') =>
    page.evaluate(
      (w) =>
        (window as unknown as { nexus: { sync: SyncApi } }).nexus.sync[w]().then(
          () => 'ok',
          (err: Error) => err.message,
        ),
      what,
    ),
});

test('a passwordless vault pushes its .db over FTP and SFTP; a pull explains why it cannot run', async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Nexus' })).toBeVisible({ timeout: 30_000 });

  const vaultPath = await page.evaluate(
    ([prfOutput, credential]) =>
      window.nexus.hardwareKey.createPasswordless({ name: 'Main Vault', prfOutput, ...credential }),
    [PRF, CREDENTIAL] as const,
  );
  expect(existsSync(vaultPath)).toBe(true);
  expect(existsSync(vaultPath + '.salt')).toBe(false);
  expect(await page.evaluate(() => window.nexus.vault.current())).toBe(vaultPath);

  // FTP (the backend in the report). The fixture has no TLS, so plain FTP.
  const s = sync(page);
  await s.configure({
    type: 'ftp',
    host: '127.0.0.1',
    port: ftp.port,
    ...FTP_CREDS,
    remotePath: '/nexus',
    ftpTls: false,
  });
  expect(await s.run('push')).toBe('ok');
  expect(readdirSync(path.join(ftpDir, 'nexus'))).toEqual(['Main Vault.db']);

  // A pull can't check the download without a master password: a plain message, no path.
  const pulled = await s.run('pull');
  expect(pulled).toMatch(/hardware key and has no master password/);
  expect(pulled).not.toMatch(/ENOENT|\.salt/);

  // SFTP: trust the throwaway host key once (Test Connection asks; background syncs don't).
  // The lock screen is still up (the vault was opened through the API, not the UI), and it
  // has no host-key prompt, so the page answers the prompt itself, as the prompt host would.
  await page.evaluate(() => {
    window.nexus.ssh.onHostKeyPrompt((prompt) => {
      void window.nexus.ssh.respondHostKey(prompt.id, 'always');
    });
  });
  const sftpConfig = {
    type: 'sftp',
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    password: ssh.password,
    remotePath: '/backups',
  };
  expect(
    await page.evaluate(
      (cfg) => (window as unknown as { nexus: { sync: SyncApi } }).nexus.sync.testConnection(cfg),
      sftpConfig,
    ),
  ).toBe(true);
  await s.configure(sftpConfig);
  expect(await s.run('push')).toBe('ok');
  expect(readdirSync(path.join(sftpDir, 'backups'))).toEqual(['Main Vault.db']);
});
