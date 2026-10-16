import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Keychain on the design system (#2367): empty state, generate (with validation), details
// (fingerprint, public key, copy, hidden private key), delete through a confirm dialog, and
// import by pasting a private key. Runs at the minimum window size (900 x 600), where every
// dialog must fit and keep its primary button on screen.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-keychain-'));
const PASSWORD = 'e2e-Keychain-Vault-73!';
const GENERATED = 'E2E Ed25519 Key';
const IMPORTED = 'E2E Imported RSA Key';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

// One app and vault for the whole file; each test builds on the previous one.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication | undefined;
let page: Page;
/** The generated key's public key, read from the generate dialog. */
let generatedPublicKey = '';

test.beforeAll(async () => {
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
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  // The copy buttons call navigator.clipboard.writeText. The system clipboard is shared with the
  // other specs running in parallel (security-settings polls it), so record the writes instead.
  await page.evaluate(() => {
    const w = window as unknown as { __copied: string };
    w.__copied = '';
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async (text: string) => {
        w.__copied = text;
      },
    });
  });

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Keychain Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
});

const main = () => page.locator('main');
const keyList = () => main().getByRole('list', { name: 'SSH keys' });
const keyItem = (name: string) => keyList().getByRole('listitem').filter({ hasText: name });
const readClipboard = () => page.evaluate(() => (window as unknown as { __copied: string }).__copied);

/** The dialog fits in the window and its primary action is on screen. */
async function expectDialogFits(dialog: Locator, primary: string): Promise<void> {
  await expect(dialog.getByRole('button', { name: primary, exact: true })).toBeInViewport();
  const fits = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  });
  expect(fits).toBe(true);
}

/** OpenSSH fingerprint of an "ssh-<type> <base64> [comment]" public key, as Nexus shows it. */
function fingerprintOf(publicKey: string): string {
  const blob = Buffer.from(publicKey.trim().split(/\s+/)[1], 'base64');
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

/** The OpenSSH "ssh-rsa <base64>" public key of an RSA private key (without a comment). */
function opensshRsaPublicKey(privatePem: string): string {
  const jwk = createPublicKey(privatePem).export({ format: 'jwk' });
  const str = (b: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    return Buffer.concat([len, b]);
  };
  // SSH mpint: big-endian, with a leading zero byte when the top bit is set.
  const mpint = (b64url: string) => {
    const raw = Buffer.from(b64url, 'base64url');
    return str(raw[0] & 0x80 ? Buffer.concat([Buffer.from([0]), raw]) : raw);
  };
  const blob = Buffer.concat([str(Buffer.from('ssh-rsa')), mpint(jwk.e!), mpint(jwk.n!)]);
  return `ssh-rsa ${blob.toString('base64')}`;
}

test('Keychain opens from the sidebar and shows the empty state', async () => {
  const nav = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Keychain', exact: true });
  await nav.click();
  await expect(nav).toHaveAttribute('aria-current', 'page');
  await expect(main().getByRole('heading', { name: 'SSH Keychain' })).toBeVisible();
  await expect(main().getByText('No SSH keys yet')).toBeVisible();
  await expect(main().getByText('0 keys')).toBeVisible();
  await expect(main().getByRole('button', { name: 'Generate Key' })).toBeVisible();
  await expect(main().getByRole('button', { name: 'Import Key' })).toBeVisible();
});

test('generating a key: an empty name is rejected, then an Ed25519 key is created', async () => {
  await main().getByRole('button', { name: 'Generate Key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate SSH Key' });
  await expect(dialog).toBeVisible();
  await expectDialogFits(dialog, 'Generate Key');

  const keyType = dialog.getByRole('radiogroup', { name: 'Key type' });
  await expect(keyType.getByRole('radio', { name: 'Ed25519' })).toBeChecked();

  // RSA adds the bit size; the dialog still fits and its footer stays on screen.
  await keyType.getByText('RSA', { exact: true }).click();
  await expect(keyType.getByRole('radio', { name: 'RSA' })).toBeChecked();
  await expect(dialog.getByRole('combobox', { name: 'Bit size' })).toHaveValue('4096');
  await expectDialogFits(dialog, 'Generate Key');
  await keyType.getByText('Ed25519', { exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Bit size' })).toHaveCount(0);

  // Submitting without a name shows the error under the field and generates nothing.
  const name = dialog.getByPlaceholder('e.g. My Server Key');
  await dialog.getByRole('button', { name: 'Generate Key', exact: true }).click();
  await expect(dialog.getByText('Key name is required')).toBeVisible();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();
  await expect(dialog).toBeVisible();

  // Typing clears the error; Enter in the field submits the form.
  await name.fill(GENERATED);
  await expect(dialog.getByText('Key name is required')).toHaveCount(0);
  await name.press('Enter');

  const publicKey = dialog.getByRole('textbox', { name: 'Public key' });
  await expect(publicKey).toHaveValue(/^ssh-ed25519 \S+/, { timeout: 30_000 });
  generatedPublicKey = await publicKey.inputValue();
  await expect(dialog.getByText(`SSH key “${GENERATED}” generated`)).toBeVisible();
  await expectDialogFits(dialog, 'Done');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  // It's in the list with its type and fingerprint.
  await expect(main().getByText('No SSH keys yet')).toHaveCount(0);
  await expect(main().getByText('1 key', { exact: true })).toBeVisible();
  const item = keyItem(GENERATED);
  await expect(item).toHaveCount(1);
  await expect(item.getByText('Ed25519', { exact: true })).toBeVisible();
  await expect(item.getByText(fingerprintOf(generatedPublicKey), { exact: true })).toBeVisible();
});

test('the details show the fingerprint and public key, copy it, and keep the private key hidden', async () => {
  // Clicking the row (its name) opens the details.
  await keyItem(GENERATED).getByText(GENERATED, { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: GENERATED });
  await expect(dialog).toBeVisible();
  await expectDialogFits(dialog, 'Done');

  await expect(dialog.getByText(fingerprintOf(generatedPublicKey), { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Public key' })).toHaveValue(generatedPublicKey);

  const copy = dialog.getByRole('button', { name: 'Copy public key' });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect.poll(readClipboard).toBe(generatedPublicKey);

  // The private key is masked until "Show".
  const privateKey = dialog.getByRole('textbox', { name: 'Private key' });
  await expect(privateKey).not.toHaveValue(/PRIVATE KEY/);
  await expect(dialog.getByRole('button', { name: 'Copy private key' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Show private key' }).click();
  await expect(privateKey).toHaveValue(/BEGIN OPENSSH PRIVATE KEY/);
  await dialog.getByRole('button', { name: 'Hide private key' }).click();
  await expect(privateKey).not.toHaveValue(/PRIVATE KEY/);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  // The row's own copy button copies the public key too.
  await page.evaluate(() => ((window as unknown as { __copied: string }).__copied = ''));
  await keyItem(GENERATED).getByRole('button', { name: `Copy public key of ${GENERATED}` }).click();
  await expect.poll(readClipboard).toBe(generatedPublicKey);
});

test('deleting a key asks first; Cancel keeps it, Delete Key removes it', async () => {
  const openDelete = async () => {
    await keyItem(GENERATED).getByRole('button', { name: `More actions for ${GENERATED}` }).click();
    await page.getByRole('menuitem', { name: 'Delete key…' }).click();
    const dialog = page.getByRole('dialog', { name: `Delete ${GENERATED}?` });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  let dialog = await openDelete();
  await expectDialogFits(dialog, 'Delete Key');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(keyItem(GENERATED)).toHaveCount(1);

  dialog = await openDelete();
  await dialog.getByRole('button', { name: 'Delete Key' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'SSH key deleted' })).toBeVisible();
  await expect(main().getByText('No SSH keys yet')).toBeVisible();
  await expect(main().getByText('0 keys')).toBeVisible();
});

test('importing a pasted private key: validation, then the key and its public key', async () => {
  // An RSA key in PKCS#1 PEM ("BEGIN RSA PRIVATE KEY"): Nexus derives the public key with
  // ssh-keygen -y, and Windows' bundled OpenSSH can't read Ed25519 keys in PKCS#8 PEM.
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const expectedPublicKey = opensshRsaPublicKey(privateKey);

  await main().getByRole('button', { name: 'Import Key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import SSH Key' });
  await expect(dialog).toBeVisible();
  await expectDialogFits(dialog, 'Import Key');

  // Nothing chosen: both errors, nothing imported.
  await dialog.getByRole('button', { name: 'Import Key', exact: true }).click();
  await expect(dialog.getByText('Choose a key file to import')).toBeVisible();
  await expect(dialog.getByText('Key name is required')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Choose File…' })).toBeFocused();

  // Switch to pasting: the file error goes, the paste box needs content.
  const source = dialog.getByRole('radiogroup', { name: 'Import from' });
  await source.getByText('Paste key', { exact: true }).click();
  await expect(source.getByRole('radio', { name: 'Paste key' })).toBeChecked();
  await expect(dialog.getByText('Choose a key file to import')).toHaveCount(0);
  const content = dialog.getByPlaceholder(/Paste your private key here/);
  await dialog.getByRole('button', { name: 'Import Key', exact: true }).click();
  await expect(dialog.getByText('Paste a private key to import')).toBeVisible();
  await expect(content).toHaveAttribute('aria-invalid', 'true');
  await expectDialogFits(dialog, 'Import Key');

  await content.fill(privateKey);
  await dialog.getByPlaceholder('e.g. Production Server Key').fill(IMPORTED);
  await expect(dialog.getByText('Paste a private key to import')).toHaveCount(0);
  await expect(dialog.getByText('Key name is required')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Import Key', exact: true }).click();

  await expect(dialog.getByText(`SSH key “${IMPORTED}” imported`)).toBeVisible({ timeout: 30_000 });
  const publicKey = dialog.getByRole('textbox', { name: 'Public key' });
  await expect(publicKey).toHaveValue(new RegExp(`^${expectedPublicKey.replace(/[+/]/g, '\\$&')}`));
  await expectDialogFits(dialog, 'Done');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  const item = keyItem(IMPORTED);
  await expect(item).toHaveCount(1);
  await expect(item.getByText('RSA 2048', { exact: true })).toBeVisible();
  await expect(item.getByText(fingerprintOf(expectedPublicKey), { exact: true })).toBeVisible();
});
