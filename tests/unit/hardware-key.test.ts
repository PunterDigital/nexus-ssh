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
import {
  folderHash,
  isPathRecordFor,
  legacyRecordId,
  recordCandidates,
  recordFileNames,
  recordId,
} from '../../src/main/hardware-key/record-names';

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

// #5902: records are named by vault path (file name + a hash of its folder). v0.6.0 named them
// after the file name only, so two vaults called Work in different folders shared one record.
describe('hardware-key record names', () => {
  const a = path.join(path.sep, 'vaults', 'a', 'Work.db');
  const b = path.join(path.sep, 'vaults', 'b', 'Work.db');

  it('names two vaults with the same file name in different folders differently', () => {
    expect(recordId(a)).not.toBe(recordId(b));
    expect(recordId(a)).toMatch(/^Work\.[0-9a-f]{12}$/);
    expect(legacyRecordId(a)).toBe('Work');
    expect(legacyRecordId(b)).toBe('Work');
    expect(recordFileNames(a)).toEqual([`${recordId(a)}.hwkey`, 'Work.hwkey']);
  });

  it('hashes the same folder the same however the path is written', () => {
    expect(folderHash(path.join(path.sep, 'vaults', 'a', '..', 'a', 'Work.db'))).toBe(folderHash(a));
    expect(recordId('/Vaults/Work.db', 'darwin')).toBe(recordId('/VAULTS/Work.db', 'darwin'));
    expect(recordId('/vaults/Work.db', 'linux')).not.toBe(recordId('/VAULTS/Work.db', 'linux'));
    // Only the folder counts: a rename in the same folder keeps the hash.
    expect(folderHash(a)).toBe(folderHash(path.join(path.dirname(a), 'Office.db')));
  });

  it('recognises path-named records for a file name, and nothing else', () => {
    expect(isPathRecordFor(`${recordId(a)}.hwkey`, 'Work')).toBe(true);
    expect(isPathRecordFor('Work.hwkey', 'Work')).toBe(false);
    expect(isPathRecordFor(`${recordId(a)}.hwkey`, 'Wor')).toBe(false);
    expect(isPathRecordFor('Work.notahash1234.hwkey', 'Work')).toBe(false);
    expect(isPathRecordFor(`Work.${recordId(a)}.hwkey`, 'Work')).toBe(false);
  });

  it('looks up the own record, then the old file-name one, then a lone record from another folder', () => {
    const own = `${recordId(a)}.hwkey`;
    const other = `${recordId(b)}.hwkey`;
    const third = `${recordId(path.join(path.sep, 'vaults', 'c', 'Work.db'))}.hwkey`;
    expect(recordCandidates(a, [])).toEqual([]);
    expect(recordCandidates(a, ['Home.hwkey', other.replace('Work', 'Home')])).toEqual([]);
    expect(recordCandidates(a, [own, 'Work.hwkey', other])).toEqual([recordId(a), 'Work', recordId(b)]);
    expect(recordCandidates(a, ['Work.hwkey'])).toEqual(['Work']);
    // The vault folder moved: the record from the old folder is the only one for that name.
    expect(recordCandidates(a, [other])).toEqual([recordId(b)]);
    // Two other folders: no telling which one is this vault's, so neither.
    expect(recordCandidates(a, [other, third])).toEqual([]);
  });
});

describe('hardware-key records by vault path (#5902)', () => {
  const vaultsA = () => path.join(fake.userData, 'folder-a');
  const vaultsB = () => path.join(fake.userData, 'folder-b');
  const storeFile = (id: string) => path.join(getStoreDir(), `${id}.hwkey`);
  const setupFor = (vaultPath: string, key: Buffer, prfOutput: Buffer, credentialId: string) =>
    hardwareKeyManager.setup({
      vaultId: hardwareKeyManager.ownRecordId(vaultPath),
      dbKey: Buffer.from(key),
      prfOutput: Buffer.from(prfOutput),
      ...info,
      credentialId,
    });

  it('keeps one record per vault for two vaults called Work in different folders', async () => {
    const workA = path.join(vaultsA(), 'Work.db');
    const workB = path.join(vaultsB(), 'Work.db');
    const keyA = Buffer.alloc(32, 1);
    const keyB = Buffer.alloc(32, 2);
    const prfA = Buffer.alloc(32, 3);
    const prfB = Buffer.alloc(32, 4);

    await setupFor(workA, keyA, prfA, 'cred-a');
    await setupFor(workB, keyB, prfB, 'cred-b'); // used to replace A's record

    expect(readdirSync(getStoreDir()).sort()).toEqual([`${recordId(workA)}.hwkey`, `${recordId(workB)}.hwkey`].sort());
    const idA = await hardwareKeyManager.findRecord(workA);
    const idB = await hardwareKeyManager.findRecord(workB);
    expect(idA).toBe(recordId(workA));
    expect(idB).toBe(recordId(workB));
    expect((await hardwareKeyManager.getCredentialInfo(idA!))?.credentialId).toBe('cred-a');
    expect((await hardwareKeyManager.getCredentialInfo(idB!))?.credentialId).toBe('cred-b');
    expect(await hardwareKeyManager.unwrapDbKey(idA!, prfA)).toEqual(keyA);
    expect(await hardwareKeyManager.unwrapDbKey(idB!, prfB)).toEqual(keyB);
    // Each one's PRF output fails on the other's record.
    await expect(hardwareKeyManager.unwrapDbKey(idA!, prfB)).rejects.toThrow();

    // Removing B's key leaves A's.
    await hardwareKeyManager.removeForVault(workB, idB!);
    expect(await hardwareKeyManager.findRecord(workB)).toBe(recordId(workA)); // lone record elsewhere
    expect(await hardwareKeyManager.findRecord(workA)).toBe(recordId(workA));
    expect(readdirSync(getStoreDir())).toEqual([`${recordId(workA)}.hwkey`]);
  });

  it('migrates a v0.6.0 record on unlock and drops the old one only after the new one has unlocked', async () => {
    const work = path.join(vaultsA(), 'Work.db');
    await setup('Work'); // what v0.6.0 wrote: hwkey-store/Work.hwkey
    const legacyBytes = readFileSync(storeFile('Work'));

    // First unlock: found under the old name, copied to the new one, old one kept.
    const first = await hardwareKeyManager.findRecord(work);
    expect(first).toBe('Work');
    expect(await hardwareKeyManager.unwrapDbKey(first!, Buffer.from(prf))).toEqual(dbKey);
    await hardwareKeyManager.settleAfterUnlock(work, first!);
    expect(readdirSync(getStoreDir()).sort()).toEqual([`${recordId(work)}.hwkey`, 'Work.hwkey'].sort());
    expect(readFileSync(storeFile('Work'))).toEqual(legacyBytes);

    // Second unlock: the new record opens the vault, so the old one goes.
    const second = await hardwareKeyManager.findRecord(work);
    expect(second).toBe(recordId(work));
    expect(await hardwareKeyManager.unwrapDbKey(second!, Buffer.from(prf))).toEqual(dbKey);
    await hardwareKeyManager.settleAfterUnlock(work, second!);
    expect(readdirSync(getStoreDir())).toEqual([`${recordId(work)}.hwkey`]);
    await expect(hardwareKeyManager.getCredentialInfo(second!)).resolves.toEqual(info);
  });

  it('keeps an old record that holds other data (another vault of the same name may use it)', async () => {
    const work = path.join(vaultsA(), 'Work.db');
    await setup('Work'); // another folder's Work, never migrated
    await setupFor(work, Buffer.alloc(32, 9), Buffer.alloc(32, 5), 'cred-own');
    const id = await hardwareKeyManager.findRecord(work);
    expect(id).toBe(recordId(work));
    await hardwareKeyManager.settleAfterUnlock(work, id!);
    expect(existsSync(storeFile('Work'))).toBe(true);
    await hardwareKeyManager.removeForVault(work, id!);
    expect(existsSync(storeFile('Work'))).toBe(true);
    expect(existsSync(storeFile(recordId(work)))).toBe(false);
  });

  it('copies nothing and keeps the old record when the unlock fails', async () => {
    const work = path.join(vaultsA(), 'Work.db');
    await setup('Work');
    const id = await hardwareKeyManager.findRecord(work);
    await expect(hardwareKeyManager.unwrapDbKey(id!, Buffer.alloc(32, 8))).rejects.toThrow();
    expect(readdirSync(getStoreDir())).toEqual(['Work.hwkey']);
  });

  it('finds the record after the vault folder moved, and copies it to the new folder name', async () => {
    const oldPath = path.join(vaultsA(), 'Work.db');
    const newPath = path.join(vaultsB(), 'Work.db');
    await setupFor(oldPath, dbKey, prf, 'cred-1');
    const id = await hardwareKeyManager.findRecord(newPath);
    expect(id).toBe(recordId(oldPath));
    await hardwareKeyManager.settleAfterUnlock(newPath, id!);
    // The old folder's record stays: a copy of the vault may still be there.
    expect(readdirSync(getStoreDir()).sort()).toEqual([`${recordId(oldPath)}.hwkey`, `${recordId(newPath)}.hwkey`].sort());
    expect(await hardwareKeyManager.unwrapDbKey(recordId(newPath), Buffer.from(prf))).toEqual(dbKey);
  });

  it('removing the key of an un-migrated vault deletes its old record', async () => {
    const work = path.join(vaultsA(), 'Work.db');
    await setup('Work');
    await hardwareKeyManager.removeForVault(work, 'Work');
    expect(await hardwareKeyManager.findRecord(work)).toBeNull();
  });
});
