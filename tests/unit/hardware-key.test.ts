import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Hardware-key unlock data (#4377): stored with safeStorage's async API only. The deprecated
// sync calls (removed in Electron 46) throw here, so any leftover use fails the test.
const fake = vi.hoisted(() => ({
  userData: '',
  available: true,
  /** Key "generation" the fake OS encryptor uses; files from an older one ask for re-encryption. */
  generation: 2,
}));

vi.mock('electron', () => {
  const removed = () => {
    throw new Error('sync safeStorage API used');
  };
  return {
    app: { getPath: () => fake.userData },
    safeStorage: {
      isEncryptionAvailable: removed,
      encryptString: removed,
      decryptString: removed,
      isAsyncEncryptionAvailable: async () => fake.available,
      encryptStringAsync: async (text: string) =>
        Buffer.from(`v${fake.generation}:${Buffer.from(text).toString('base64')}`),
      decryptStringAsync: async (encrypted: Buffer) => {
        const [tag, body] = encrypted.toString().split(':');
        return {
          result: Buffer.from(body, 'base64').toString(),
          shouldReEncrypt: tag !== `v${fake.generation}`,
        };
      },
    },
  };
});

import { getStoreDir, hardwareKeyManager } from '../../src/main/hardware-key/index';

const prf = Buffer.alloc(32, 7);
const dbKey = Buffer.alloc(32, 42);
const info = {
  credentialId: 'cred-1',
  prfSalt: Buffer.alloc(32, 1).toString('base64'),
  rpId: 'localhost',
  userHandle: 'user-1',
  passwordless: true,
};

const setup = (vaultId = 'Vault') =>
  hardwareKeyManager.setup({ vaultId, dbKey: Buffer.from(dbKey), prfOutput: Buffer.from(prf), ...info });

beforeEach(() => {
  fake.userData = mkdtempSync(path.join(tmpdir(), 'nexus-hwkey-'));
  fake.available = true;
  fake.generation = 2;
});

afterEach(() => {
  rmSync(fake.userData, { recursive: true, force: true });
});

describe('hardware-key store', () => {
  it('stores the unlock data encrypted and unwraps the vault key with the same PRF output', async () => {
    await setup();

    expect(hardwareKeyManager.isSetup('Vault')).toBe(true);
    expect(readdirSync(getStoreDir())).toEqual(['Vault.hwkey']); // no .tmp left behind
    expect(readFileSync(path.join(getStoreDir(), 'Vault.hwkey'), 'utf8')).not.toContain('cred-1');
    await expect(hardwareKeyManager.getCredentialInfo('Vault')).resolves.toEqual(info);
    expect(await hardwareKeyManager.unwrapDbKey('Vault', Buffer.from(prf))).toEqual(dbKey);
  });

  it('refuses a different PRF output', async () => {
    await setup();
    await expect(hardwareKeyManager.unwrapDbKey('Vault', Buffer.alloc(32, 8))).rejects.toThrow(
      'Hardware key did not produce the expected secret',
    );
  });

  it('re-encrypts data written under an older OS key and still unlocks', async () => {
    fake.generation = 1;
    await setup();
    const file = path.join(getStoreDir(), 'Vault.hwkey');
    expect(readFileSync(file, 'utf8').startsWith('v1:')).toBe(true);

    fake.generation = 2;
    expect(await hardwareKeyManager.unwrapDbKey('Vault', Buffer.from(prf))).toEqual(dbKey);
    expect(readFileSync(file, 'utf8').startsWith('v2:')).toBe(true);
    await expect(hardwareKeyManager.getCredentialInfo('Vault')).resolves.toEqual(info);
  });

  it('reports a missing or unreadable store', async () => {
    await expect(hardwareKeyManager.getCredentialInfo('Nope')).resolves.toBeNull();
    await expect(hardwareKeyManager.unwrapDbKey('Nope', Buffer.from(prf))).rejects.toThrow(
      'Hardware key is not set up for this vault.',
    );

    mkdirSync(getStoreDir(), { recursive: true });
    writeFileSync(path.join(getStoreDir(), 'Bad.hwkey'), `v2:${Buffer.from('not json').toString('base64')}`);
    await expect(hardwareKeyManager.getCredentialInfo('Bad')).resolves.toBeNull();
  });

  it('fails clearly when OS encryption is not available', async () => {
    fake.available = false;
    await expect(setup()).rejects.toThrow('OS encryption is not available');
    expect(existsSync(path.join(fake.userData, 'hwkey-store', 'Vault.hwkey'))).toBe(false);

    fake.available = true;
    await setup();
    fake.available = false;
    await expect(hardwareKeyManager.getCredentialInfo('Vault')).rejects.toThrow('OS encryption is not available');
  });

  it('clear removes the unlock data', async () => {
    await setup();
    hardwareKeyManager.clear('Vault');
    expect(hardwareKeyManager.isSetup('Vault')).toBe(false);
  });
});
