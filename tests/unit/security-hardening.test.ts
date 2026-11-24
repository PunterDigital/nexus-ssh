import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { utils as sshUtils } from 'ssh2';
import { isInsideRoot, isPermissionAllowed } from '../../src/main/security/paths';
import { keyboardInteractiveAnswers } from '../../src/main/ssh/keyboard-interactive';
import { forgetPickedFiles, rememberPickedFiles, takePickedFile } from '../../src/main/fs/picked-files';

vi.mock('electron', () => ({
  clipboard: { readText: vi.fn(async () => ''), writeText: vi.fn(async () => {}) },
  powerMonitor: { on: vi.fn(), getSystemIdleTime: vi.fn(() => 0) },
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn() },
}));
vi.mock('../../src/main/vault', () => ({ vaultEngine: { isUnlocked: () => false, lock: vi.fn() } }));
const { idleLockDisabled } = await import('../../src/main/security');
const { generateKeyPairPem, keychainManager } = await import('../../src/main/keychain');

// #5612: hardening from the #5474 audit.

describe('idle lock env gate', () => {
  it('turns idle lock off only for a test profile', () => {
    expect(idleLockDisabled({ NEXUS_DISABLE_IDLE_LOCK: '1', NEXUS_USER_DATA_DIR: 'C:/tmp/p' })).toBe(true);
    expect(idleLockDisabled({ NEXUS_DISABLE_IDLE_LOCK: '1' })).toBe(false);
    expect(idleLockDisabled({ NEXUS_USER_DATA_DIR: 'C:/tmp/p' })).toBe(false);
    expect(idleLockDisabled({})).toBe(false);
  });
});

describe('keyboard-interactive answers', () => {
  it('answers a single hidden password prompt with the stored password', () => {
    expect(keyboardInteractiveAnswers([{ prompt: 'Password: ', echo: false }], 'pw')).toEqual(['pw']);
    expect(keyboardInteractiveAnswers([{ prompt: 'tester@host password:' }], 'pw')).toEqual(['pw']);
  });

  it('never types the password into other prompts', () => {
    const none = (prompts: { prompt: string; echo?: boolean }[]) =>
      keyboardInteractiveAnswers(prompts, 'pw');
    expect(none([{ prompt: 'Verification code: ', echo: false }])).toEqual(['']);
    expect(none([{ prompt: 'Password: ', echo: true }])).toEqual(['']); // visible: not a password field
    expect(none([{ prompt: 'Password: ' }, { prompt: 'OTP: ' }])).toEqual(['', '']);
    expect(none([])).toEqual([]);
    expect(keyboardInteractiveAnswers([{ prompt: 'Password: ' }], null)).toEqual(['']);
  });
});

describe('renderer server path check', () => {
  const root = path.resolve('/app/dist/renderer');
  it('accepts the root and files inside it', () => {
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(root, path.join(root, 'index.html'))).toBe(true);
    expect(isInsideRoot(root, path.join(root, 'assets', 'a.js'))).toBe(true);
  });
  it('refuses a sibling folder that shares the prefix, and anything outside', () => {
    expect(isInsideRoot(root, path.resolve('/app/dist/renderer-old/secret.txt'))).toBe(false);
    expect(isInsideRoot(root, path.resolve('/app/dist/main/index.js'))).toBe(false);
    expect(isInsideRoot(root, path.join(root, '..', 'main', 'index.js'))).toBe(false);
  });
});

describe('renderer permissions', () => {
  it('allows only the clipboard', () => {
    expect(isPermissionAllowed('clipboard-read')).toBe(true);
    expect(isPermissionAllowed('clipboard-sanitized-write')).toBe(true);
    for (const p of ['media', 'geolocation', 'notifications', 'hid', 'usb', 'serial', 'midi', 'openExternal']) {
      expect(isPermissionAllowed(p)).toBe(false);
    }
  });
});

describe('picked files (key import)', () => {
  it('accepts a picked path once, and nothing else', () => {
    forgetPickedFiles();
    const f = path.resolve('/keys/id_ed25519');
    expect(takePickedFile(f)).toBe(false);
    rememberPickedFiles([f]);
    expect(takePickedFile(path.resolve('/keys/other'))).toBe(false);
    expect(takePickedFile(f)).toBe(true);
    expect(takePickedFile(f)).toBe(false);
  });
  it('expires after 10 minutes', () => {
    const f = path.resolve('/keys/id_rsa');
    rememberPickedFiles([f], 0);
    expect(takePickedFile(f, 11 * 60 * 1000)).toBe(false);
  });
});

describe('key generation and import without a passphrase on a command line', () => {
  it.each([
    ['ed25519', undefined],
    ['ecdsa', 256],
    ['rsa', 2048],
  ] as const)('generates a %s key that parses with its passphrase and not without', async (type, bits) => {
    const { privateKey, publicKey } = await generateKeyPairPem(type, bits, 'secret pass', 'me@test');
    expect(privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
    const parsed = sshUtils.parseKey(privateKey, 'secret pass');
    expect(parsed).not.toBeInstanceOf(Error);
    expect(sshUtils.parseKey(privateKey, 'wrong')).toBeInstanceOf(Error);
    expect(publicKey.split(' ')[1]).toBe(
      (parsed as { getPublicSSH(): Buffer }).getPublicSSH().toString('base64'),
    );
  });

  it('imports a pasted encrypted key and derives its public key in-process', async () => {
    const { privateKey, publicKey } = await generateKeyPairPem('ed25519', undefined, 'pp', 'c');
    const key = await keychainManager.importKey({
      name: 'k',
      privateKeyContent: privateKey,
      vaultId: 'v',
      passphrase: 'pp',
    });
    expect(key.public_key.split(' ').slice(0, 2)).toEqual(publicKey.split(' ').slice(0, 2));
    expect(key.fingerprint).toMatch(/^SHA256:/);
    await expect(
      keychainManager.importKey({ name: 'k', privateKeyContent: privateKey, vaultId: 'v', passphrase: 'nope' }),
    ).rejects.toThrow(/Couldn't read the key/);
  });
});
