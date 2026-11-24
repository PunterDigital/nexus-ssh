import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  deleteVault,
  renameVault,
  resolveListedVault,
  sanitizeVaultFilename,
  type VaultFileContext,
} from '../../src/main/vault/manage';
import { recordFileNames } from '../../src/main/hardware-key/record-names';

// Vault rename / delete from the vault picker (#2646), against a temp profile.
let root: string;
let ctx: VaultFileContext;
let trashed: string[];

const vaultDir = () => path.join(root, 'vaults');
const hwDir = () => path.join(root, 'hwkey-store');
const pinDir = () => path.join(root, 'pin-store');
const trashDir = () => path.join(root, 'trash');
/** The path-named hardware-key record of a vault called `name` in the vaults folder (#5902). */
const hw = (name: string) => recordFileNames(path.join(vaultDir(), `${name}.db`))[0];

/** A vault with a salt and, optionally, hardware-key / PIN unlock data. */
function makeVault(
  name: string,
  opts: { hwkey?: boolean; legacyHwkey?: boolean; pin?: boolean; salt?: boolean } = {},
): string {
  const db = path.join(vaultDir(), `${name}.db`);
  writeFileSync(db, `db:${name}`);
  if (opts.salt !== false) writeFileSync(`${db}.salt`, `salt:${name}`);
  if (opts.hwkey) writeFileSync(path.join(hwDir(), hw(name)), `hw:${name}`);
  // The record v0.6.0 and earlier wrote, named after the file only.
  if (opts.legacyHwkey) writeFileSync(path.join(hwDir(), `${name}.hwkey`), `old:${name}`);
  if (opts.pin) writeFileSync(path.join(pinDir(), `${name}.pin`), `pin:${name}`);
  return db;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nexus-vault-manage-'));
  for (const dir of [vaultDir(), hwDir(), pinDir(), trashDir()]) mkdirSync(dir);
  trashed = [];
  ctx = {
    vaultDir: vaultDir(),
    sideStores: [
      {
        dir: hwDir(),
        fileNames: (vaultPath: string) => {
          const [own, legacy] = recordFileNames(vaultPath);
          return [
            { name: own, trashStale: true },
            { name: legacy, trashStale: false },
          ];
        },
      },
      { dir: pinDir(), fileNames: (vaultPath: string) => [{ name: `${path.basename(vaultPath, '.db')}.pin`, trashStale: true }] },
    ],
    openVaultPath: null,
    trash: vi.fn(async (file: string) => {
      trashed.push(file);
      renameSync(file, path.join(trashDir(), `${trashed.length}-${path.basename(file)}`));
    }),
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveListedVault', () => {
  it('accepts a .db in the vaults folder', async () => {
    const db = makeVault('Work');
    await expect(resolveListedVault(db, ctx)).resolves.toBe(path.resolve(db));
  });

  it('refuses files outside the vaults folder, non-vault files and missing vaults', async () => {
    const outside = path.join(root, 'Other.db');
    writeFileSync(outside, 'x');
    await expect(resolveListedVault(outside, ctx)).rejects.toThrow('not in the vaults folder');
    await expect(resolveListedVault(path.join(vaultDir(), '..', 'Other.db'), ctx)).rejects.toThrow(
      'not in the vaults folder',
    );
    const salt = `${makeVault('Work')}.salt`;
    await expect(resolveListedVault(salt, ctx)).rejects.toThrow('not in the vaults folder');
    await expect(resolveListedVault(path.join(vaultDir(), 'Gone.db'), ctx)).rejects.toThrow('Vault not found');
    await expect(resolveListedVault(42, ctx)).rejects.toThrow('No vault given');
  });
});

describe('deleteVault', () => {
  it('moves the vault, its salt and its unlock data to the trash and leaves other vaults alone', async () => {
    const work = makeVault('Work', { hwkey: true, pin: true });
    const home = makeVault('Home', { hwkey: true });

    await deleteVault(work, ctx);

    expect(trashed.map((f) => path.basename(f))).toEqual(['Work.db', 'Work.db.salt', hw('Work'), 'Work.pin']);
    expect(trashed[0]).toBe(path.resolve(work));
    expect(readdirSync(vaultDir()).sort()).toEqual(['Home.db', 'Home.db.salt']);
    expect(readdirSync(hwDir())).toEqual([hw('Home')]);
    expect(readdirSync(pinDir())).toEqual([]);
    // Recoverable: the files are in the trash, not gone.
    expect(readdirSync(trashDir())).toHaveLength(4);
    expect(existsSync(home)).toBe(true);
  });

  it('also trashes the backups a sync pull kept (#5611)', async () => {
    const work = makeVault('Work');
    writeFileSync(`${work}.bak`, 'old db');
    writeFileSync(`${work}.salt.bak`, 'old salt');

    await deleteVault(work, ctx);

    expect(trashed.map((f) => path.basename(f)).sort()).toEqual(
      ['Work.db', 'Work.db.bak', 'Work.db.salt', 'Work.db.salt.bak'].sort()
    );
    expect(readdirSync(vaultDir())).toEqual([]);
  });

  it('renames the backups a sync pull kept along with the vault (#5611)', async () => {
    const work = makeVault('Work');
    writeFileSync(`${work}.bak`, 'old db');
    writeFileSync(`${work}.salt.bak`, 'old salt');

    const next = await renameVault(work, 'Office', ctx);

    expect(readdirSync(vaultDir()).sort()).toEqual(
      ['Office.db', 'Office.db.bak', 'Office.db.salt', 'Office.db.salt.bak'].sort()
    );
    expect(readFileSync(`${next}.bak`, 'utf8')).toBe('old db');
  });

  it('trashes both hardware-key record names (#5902) and not other folders\' records', async () => {
    const db = makeVault('Work', { hwkey: true, legacyHwkey: true });
    const elsewhere = recordFileNames(path.join(root, 'other folder', 'Work.db'))[0];
    writeFileSync(path.join(hwDir(), elsewhere), 'hw:Work elsewhere');
    await deleteVault(db, ctx);
    expect(trashed.map((f) => path.basename(f))).toEqual(['Work.db', 'Work.db.salt', hw('Work'), 'Work.hwkey']);
    expect(readdirSync(hwDir())).toEqual([elsewhere]);
  });

  it('deletes a passwordless (hardware-key only) vault, which has no salt', async () => {
    const db = makeVault('Keyless', { salt: false, hwkey: true });
    await deleteVault(db, ctx);
    expect(trashed.map((f) => path.basename(f))).toEqual(['Keyless.db', hw('Keyless')]);
  });

  it('refuses the open vault', async () => {
    const db = makeVault('Work');
    ctx.openVaultPath = db;
    await expect(deleteVault(db, ctx)).rejects.toThrow('Lock or switch away');
    expect(trashed).toEqual([]);
    expect(existsSync(db)).toBe(true);
  });

  it('touches nothing else when the trash refuses the .db', async () => {
    const db = makeVault('Work', { hwkey: true });
    ctx.trash = vi.fn(async () => {
      throw new Error('Recycle Bin unavailable');
    });
    await expect(deleteVault(db, ctx)).rejects.toThrow('Recycle Bin unavailable');
    expect(ctx.trash).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(hwDir(), hw('Work')))).toBe(true);
  });
});

describe('renameVault', () => {
  it('renames the vault, its salt and its unlock data, keeping their contents', async () => {
    const db = makeVault('Work', { hwkey: true, pin: true });

    const next = await renameVault(db, '  Client  Work ', ctx);

    expect(next).toBe(path.join(path.resolve(vaultDir()), 'Client Work.db'));
    expect(readdirSync(vaultDir()).sort()).toEqual(['Client Work.db', 'Client Work.db.salt']);
    expect(readFileSync(next, 'utf8')).toBe('db:Work');
    expect(readFileSync(`${next}.salt`, 'utf8')).toBe('salt:Work');
    expect(readFileSync(path.join(hwDir(), hw('Client Work')), 'utf8')).toBe('hw:Work');
    expect(readFileSync(path.join(pinDir(), 'Client Work.pin'), 'utf8')).toBe('pin:Work');
    expect(trashed).toEqual([]);
  });

  it('strips characters a file name cannot hold', async () => {
    const db = makeVault('Work');
    const next = await renameVault(db, 'a/b:c*?', ctx);
    expect(path.basename(next)).toBe('abc.db');
  });

  it('refuses an empty name, a name another vault has, and the open vault', async () => {
    const work = makeVault('Work');
    makeVault('Home');
    await expect(renameVault(work, '   ', ctx)).rejects.toThrow('Enter a name');
    await expect(renameVault(work, 'Home', ctx)).rejects.toThrow('A vault called "Home" already exists');
    ctx.openVaultPath = work;
    await expect(renameVault(work, 'Elsewhere', ctx)).rejects.toThrow('Lock or switch away');
    expect(readdirSync(vaultDir()).sort()).toEqual(['Home.db', 'Home.db.salt', 'Work.db', 'Work.db.salt']);
  });

  it('keeping the same name changes nothing', async () => {
    const db = makeVault('Work');
    await expect(renameVault(db, 'Work', ctx)).resolves.toBe(path.resolve(db));
  });

  it('throws away unlock data left behind for the new name, so it cannot attach to this vault', async () => {
    const db = makeVault('Work');
    writeFileSync(path.join(hwDir(), hw('Old')), 'stale');
    await renameVault(db, 'Old', ctx);
    expect(trashed.map((f) => path.basename(f))).toEqual([hw('Old')]);
    expect(existsSync(path.join(hwDir(), hw('Old')))).toBe(false);
  });

  it('puts already-moved files back when a later rename fails', async () => {
    const db = makeVault('Work', { hwkey: true });
    // A directory where the renamed .hwkey should go makes that step fail.
    mkdirSync(path.join(hwDir(), hw('New')));
    writeFileSync(path.join(hwDir(), hw('New'), 'keep'), 'x');
    await expect(renameVault(db, 'New', ctx)).rejects.toThrow();
    expect(readdirSync(vaultDir()).sort()).toEqual(['Work.db', 'Work.db.salt']);
    expect(existsSync(path.join(hwDir(), hw('Work')))).toBe(true);
  });

  // #5902: hardware-key records named by vault path, and the file-name ones v0.6.0 wrote.
  it('moves the old file-name hardware-key record along with the path-named one', async () => {
    const db = makeVault('Work', { hwkey: true, legacyHwkey: true });
    await renameVault(db, 'Office', ctx);
    expect(readdirSync(hwDir()).sort()).toEqual([hw('Office'), 'Office.hwkey'].sort());
    expect(readFileSync(path.join(hwDir(), 'Office.hwkey'), 'utf8')).toBe('old:Work');
    expect(trashed).toEqual([]);
  });

  it('never overwrites or trashes a file-name record another vault may still use', async () => {
    // Office.hwkey: an un-migrated record of a vault called Office in some other folder.
    const db = makeVault('Work', { legacyHwkey: true });
    writeFileSync(path.join(hwDir(), 'Office.hwkey'), 'old:Office elsewhere');
    await renameVault(db, 'Office', ctx);
    expect(readFileSync(path.join(hwDir(), 'Office.hwkey'), 'utf8')).toBe('old:Office elsewhere');
    expect(readFileSync(path.join(hwDir(), 'Work.hwkey'), 'utf8')).toBe('old:Work');
    expect(trashed).toEqual([]);
  });

  it('leaves path-named records of same-named vaults in other folders alone', async () => {
    const db = makeVault('Work', { hwkey: true });
    const elsewhere = recordFileNames(path.join(root, 'other folder', 'Work.db'))[0];
    writeFileSync(path.join(hwDir(), elsewhere), 'hw:Work elsewhere');
    await renameVault(db, 'Office', ctx);
    expect(readdirSync(hwDir()).sort()).toEqual([elsewhere, hw('Office')].sort());
  });
});

describe('sanitizeVaultFilename', () => {
  it('keeps spaces and case, strips invalid characters and trailing dots', () => {
    expect(sanitizeVaultFilename(' My  Vault ')).toBe('My Vault');
    expect(sanitizeVaultFilename('a<b>c|d')).toBe('abcd');
    expect(sanitizeVaultFilename('Work...')).toBe('Work');
    expect(sanitizeVaultFilename('???')).toBe('vault');
  });
});
