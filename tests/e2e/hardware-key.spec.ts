import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Hardware-key unlock data (#4377): main stores it with safeStorage's async API. The WebAuthn
// ceremony needs a real key, so the test hands main a fixed 32-byte "PRF output" through the same
// preload calls the lock screen uses, restarts, and unlocks with it.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-hwkey-'));
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
const PRF = Buffer.alloc(32, 7).toString('base64');
const WRONG_PRF = Buffer.alloc(32, 8).toString('base64');
const CREDENTIAL = {
  credentialId: 'e2e-credential',
  prfSalt: Buffer.alloc(32, 1).toString('base64'),
  rpId: 'localhost',
  userHandle: 'e2e-user',
};

let app: ElectronApplication | undefined;
let mainOutput = '';

async function launch(): Promise<ElectronApplication> {
  const launched = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
  launched.process().stderr?.on('data', (chunk: Buffer) => (mainOutput += chunk.toString()));
  launched.process().stdout?.on('data', (chunk: Buffer) => (mainOutput += chunk.toString()));
  return launched;
}

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
});

test('hardware key: a passwordless vault unlocks with its PRF output after a restart', async () => {
  test.setTimeout(180_000);
  app = await launch();
  let page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Nexus' })).toBeVisible({ timeout: 30_000 });

  const vaultPath = await page.evaluate(
    ([prfOutput, credential]) =>
      window.nexus.hardwareKey.createPasswordless({ name: 'HW Vault', prfOutput, ...credential }),
    [PRF, CREDENTIAL] as const,
  );
  expect(path.basename(vaultPath)).toBe('HW Vault.db');
  expect(existsSync(path.join(userDataDir, 'hwkey-store', 'HW Vault.hwkey'))).toBe(true);
  await app.close();

  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Nexus' })).toBeVisible({ timeout: 30_000 });

  expect(await page.evaluate((p) => window.nexus.hardwareKey.has(p), vaultPath)).toBe(true);
  expect(await page.evaluate((p) => window.nexus.hardwareKey.getInfo(p), vaultPath)).toEqual({
    ...CREDENTIAL,
    passwordless: true,
  });

  const wrong = await page.evaluate(
    ([p, prfOutput]) =>
      window.nexus.hardwareKey.unlock({ vaultPath: p, prfOutput }).then(
        () => 'unlocked',
        (err: Error) => err.message,
      ),
    [vaultPath, WRONG_PRF] as const,
  );
  expect(wrong).toContain('Hardware key did not produce the expected secret');

  expect(
    await page.evaluate(([p, prfOutput]) => window.nexus.hardwareKey.unlock({ vaultPath: p, prfOutput }), [
      vaultPath,
      PRF,
    ] as const),
  ).toBe(vaultPath);
  expect(await page.evaluate(() => window.nexus.vault.current())).toBe(vaultPath);

  // A passwordless vault's only key can't be removed.
  await expect(page.evaluate((p) => window.nexus.hardwareKey.remove(p), vaultPath)).rejects.toThrow(
    'Cannot remove the hardware key from a passwordless vault',
  );

  // The removed-in-Electron-46 sync safeStorage calls print a deprecation warning when used.
  expect(mainOutput).not.toMatch(/deprecat/i);
});
