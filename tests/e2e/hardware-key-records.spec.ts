import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Hardware-key records by vault path (#5902). Up to v0.6.0 a vault's hardware-key unlock data
// was `hwkey-store/<file name>.hwkey`, so two vaults with the same file name in different folders
// shared (and overwrote) one record. Now it's `<file name>.<hash of its folder>.hwkey`; an old
// record is copied to the new name on the first unlock and deleted once the copy has unlocked.
//
// The WebAuthn ceremony needs a real key, so (as in hardware-key.spec.ts) the page hands main a
// fixed 32-byte "PRF output" through the lock screen's preload calls. Every launch uses a
// throwaway test profile.
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;
const PRF_A = Buffer.alloc(32, 7).toString('base64');
const PRF_B = Buffer.alloc(32, 9).toString('base64');
const credential = (id: string) => ({
  credentialId: id,
  prfSalt: Buffer.alloc(32, 1).toString('base64'),
  rpId: 'localhost',
  userHandle: `user-${id}`,
});

const roots: string[] = [];
let app: ElectronApplication | undefined;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

async function launch(userDataDir: string): Promise<Page> {
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
  return page;
}

async function close(): Promise<void> {
  await app?.close().catch(() => {});
  app = undefined;
}

const store = (userDataDir: string) => readdirSync(path.join(userDataDir, 'hwkey-store')).sort();

const unlock = (page: Page, vaultPath: string, prfOutput: string) =>
  page.evaluate(
    ([p, prf]) =>
      window.nexus.hardwareKey.unlock({ vaultPath: p, prfOutput: prf }).then(
        () => 'unlocked',
        (err: Error) => err.message,
      ),
    [vaultPath, prfOutput] as const,
  );

test.afterEach(async () => {
  await close();
});

test.afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

test('two vaults with the same file name in different folders keep their own hardware keys', async () => {
  test.setTimeout(180_000);
  const userDataDir = tempDir('nexus-e2e-hwkey-two-');
  const otherFolder = path.join(userDataDir, 'other vaults');
  mkdirSync(otherFolder);

  let page = await launch(userDataDir);
  const first = await page.evaluate(
    ([prfOutput, cred]) => window.nexus.hardwareKey.createPasswordless({ name: 'Work', prfOutput, ...cred }),
    [PRF_A, credential('cred-a')] as const,
  );
  // New vaults go to the folder set in the open vault's settings: point it at another folder
  // and create a second "Work" there with a different key.
  await page.evaluate((dir) => window.nexus.settings.set('defaultVaultPath', dir), otherFolder);
  const second = await page.evaluate(
    ([prfOutput, cred]) => window.nexus.hardwareKey.createPasswordless({ name: 'Work', prfOutput, ...cred }),
    [PRF_B, credential('cred-b')] as const,
  );
  expect(path.basename(first)).toBe('Work.db');
  expect(path.basename(second)).toBe('Work.db');
  expect(path.dirname(second)).toBe(otherFolder);
  // Two records: before #5902 the second create replaced the first one's.
  expect(store(userDataDir)).toHaveLength(2);
  await close();

  page = await launch(userDataDir);
  for (const [vaultPath, id] of [
    [first, 'cred-a'],
    [second, 'cred-b'],
  ] as const) {
    expect(await page.evaluate((p) => window.nexus.hardwareKey.has(p), vaultPath)).toBe(true);
    const info = await page.evaluate((p) => window.nexus.hardwareKey.getInfo(p), vaultPath);
    expect(info.credentialId).toBe(id);
  }
  // Each vault opens with its own key only.
  expect(await unlock(page, first, PRF_B)).toContain('Hardware key did not produce the expected secret');
  expect(await unlock(page, first, PRF_A)).toBe('unlocked');
  expect(await page.evaluate(() => window.nexus.vault.current())).toBe(first);
  await page.evaluate(() => window.nexus.vault.lock());
  expect(await unlock(page, second, PRF_A)).toContain('Hardware key did not produce the expected secret');
  expect(await unlock(page, second, PRF_B)).toBe('unlocked');
  expect(await page.evaluate(() => window.nexus.vault.current())).toBe(second);
  expect(store(userDataDir)).toHaveLength(2);
});

test('a v0.6.0 hardware-key record migrates on unlock, on a copy of the profile', async () => {
  test.setTimeout(180_000);
  // 1. A profile with a passwordless vault and its hardware-key record...
  const original = tempDir('nexus-e2e-hwkey-orig-');
  let page = await launch(original);
  await page.evaluate(
    ([prfOutput, cred]) => window.nexus.hardwareKey.createPasswordless({ name: 'Legacy', prfOutput, ...cred }),
    [PRF_A, credential('cred-legacy')] as const,
  );
  await close();
  // ...turned into what v0.6.0 left on disk: the same encrypted file, named after the vault's
  // file name only (the contents didn't change in #5902, only the name).
  const [pathNamed] = store(original);
  expect(pathNamed).toMatch(/^Legacy\.[0-9a-f]{12}\.hwkey$/);
  renameSync(path.join(original, 'hwkey-store', pathNamed), path.join(original, 'hwkey-store', 'Legacy.hwkey'));
  const legacyBytes = readFileSync(path.join(original, 'hwkey-store', 'Legacy.hwkey'));

  // 2. Work on a copy of that profile, never the original.
  const copy = tempDir('nexus-e2e-hwkey-copy-');
  cpSync(original, copy, { recursive: true });
  const vaultPath = path.join(copy, 'vaults', 'Legacy.db');

  page = await launch(copy);
  expect(await page.evaluate((p) => window.nexus.hardwareKey.has(p), vaultPath)).toBe(true);
  expect((await page.evaluate((p) => window.nexus.hardwareKey.getInfo(p), vaultPath)).credentialId).toBe(
    'cred-legacy',
  );

  // A failed unlock copies nothing.
  expect(await unlock(page, vaultPath, PRF_B)).toContain('Hardware key did not produce the expected secret');
  expect(store(copy)).toEqual(['Legacy.hwkey']);

  // First unlock: the old record opens the vault and is copied to the new name; it stays.
  expect(await unlock(page, vaultPath, PRF_A)).toBe('unlocked');
  expect(await page.evaluate(() => window.nexus.vault.current())).toBe(vaultPath);
  const migrated = store(copy);
  expect(migrated).toHaveLength(2);
  expect(migrated).toContain('Legacy.hwkey');
  const newName = migrated.find((f) => f !== 'Legacy.hwkey')!;
  expect(newName).toMatch(/^Legacy\.[0-9a-f]{12}\.hwkey$/);
  expect(readFileSync(path.join(copy, 'hwkey-store', 'Legacy.hwkey'))).toEqual(legacyBytes);
  await close();

  // Second unlock (after a restart): the new record opens it, so the old one is deleted.
  page = await launch(copy);
  expect(await unlock(page, vaultPath, PRF_A)).toBe('unlocked');
  expect(store(copy)).toEqual([newName]);
  await page.evaluate(() => window.nexus.vault.lock());
  expect(await unlock(page, vaultPath, PRF_A)).toBe('unlocked');
  expect(store(copy)).toEqual([newName]);

  // The original profile was never touched.
  expect(store(original)).toEqual(['Legacy.hwkey']);
  expect(readFileSync(path.join(original, 'hwkey-store', 'Legacy.hwkey'))).toEqual(legacyBytes);
});
