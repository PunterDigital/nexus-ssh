// ============================================================
// Nexus SSH Client — Vault file management (#2646)
// Rename and delete vaults from the vault picker. No Electron
// imports: the IPC handlers pass in the folders and the trash
// function, so this is unit-tested against a temp directory.
// ============================================================

import path from 'path';
import { promises as fs } from 'fs';
import { VAULT_FILE_EXTENSION, VAULT_SALT_EXTENSION } from '../../shared/constants';

/** Where a vault's files live and how to throw them away. */
export interface VaultFileContext {
  /** The folder the vault picker lists. */
  vaultDir: string;
  /**
   * Per-vault files Nexus keeps outside the vault folder (hardware-key unlock data). They follow
   * a rename and go with a delete.
   */
  sideStores: SideStore[];
  /** The vault that is open right now (it can't be renamed or deleted), or null. */
  openVaultPath: string | null;
  /** Move a file to the OS Recycle Bin / Trash. */
  trash: (file: string) => Promise<void>;
}

/** A folder of per-vault files kept outside the vault folder. */
export interface SideStore {
  dir: string;
  /**
   * The vault's file names in `dir`, given its path; the same order for any path, so a rename
   * pairs them up. `trashStale`: a file already under the new name when the vault had none is
   * left over from a vault deleted by hand, and goes to the trash rather than attach itself to
   * the renamed vault. False for names other vaults may share (#5902: the old file-name
   * hardware-key record, which a same-named vault in another folder may still use).
   */
  fileNames: (vaultPath: string) => Array<{ name: string; trashStale: boolean }>;
}

/** SQLite files that sit next to the .db (only after a crash, usually). */
const DB_COMPANIONS = ['-journal', '-wal', '-shm'];

/** The copies a sync pull keeps of the vault it replaced (#5611): `<name>.db.bak`, `<name>.db.salt.bak`. */
const PULL_BACKUPS = ['.bak', `${VAULT_SALT_EXTENSION}.bak`];

/**
 * Turn a vault name into a safe filename while preserving spaces and
 * capitalization. Only strips characters that are invalid on common
 * filesystems (Windows is the strictest: <>:"/\|?*).
 */
export function sanitizeVaultFilename(name: string): string {
  const cleaned = name
    .trim()
    // Remove filesystem-invalid characters
    // eslint-disable-next-line no-control-regex -- control characters are invalid in filenames
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '')
    // Collapse repeated spaces
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    // Windows drops trailing dots and spaces from file names
    .replace(/[. ]+$/, '');
  return cleaned || 'vault';
}

/** The picker's name for a vault: its file name without `.db`. */
export function vaultNameFromPath(vaultPath: string): string {
  return path.basename(vaultPath, VAULT_FILE_EXTENSION);
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' || process.platform === 'darwin'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check that `vaultPath` is a vault the picker lists: a `.db` file directly inside the vault
 * folder. The renderer sends the path, so this keeps rename and delete to that folder.
 */
export async function resolveListedVault(vaultPath: unknown, ctx: VaultFileContext): Promise<string> {
  if (typeof vaultPath !== 'string' || !vaultPath) throw new Error('No vault given');
  const resolved = path.resolve(vaultPath);
  if (!resolved.endsWith(VAULT_FILE_EXTENSION) || !samePath(path.dirname(resolved), ctx.vaultDir)) {
    throw new Error('That file is not in the vaults folder');
  }
  if (!(await exists(resolved))) throw new Error('Vault not found');
  return resolved;
}

function assertNotOpen(vaultPath: string, ctx: VaultFileContext, action: string): void {
  if (ctx.openVaultPath && samePath(ctx.openVaultPath, vaultPath)) {
    throw new Error(`Lock or switch away from this vault before you ${action} it`);
  }
}

/**
 * Every file that belongs to the vault, as [current path, path for a vault called `name`,
 * whether a stale file at the new path goes to the trash].
 */
function vaultFilePairs(vaultPath: string, name: string, ctx: VaultFileContext): Array<[string, string, boolean]> {
  const target = path.join(path.dirname(vaultPath), `${name}${VAULT_FILE_EXTENSION}`);
  const pairs: Array<[string, string, boolean]> = [
    [vaultPath, target, true],
    [vaultPath + VAULT_SALT_EXTENSION, target + VAULT_SALT_EXTENSION, true],
    ...DB_COMPANIONS.map((s): [string, string, boolean] => [vaultPath + s, target + s, true]),
    ...PULL_BACKUPS.map((s): [string, string, boolean] => [vaultPath + s, target + s, true]),
  ];
  for (const store of ctx.sideStores) {
    const from = store.fileNames(vaultPath);
    const to = store.fileNames(target);
    from.forEach(({ name: file, trashStale }, i) => {
      pairs.push([path.join(store.dir, file), path.join(store.dir, to[i].name), trashStale]);
    });
  }
  return pairs;
}

/**
 * Rename a vault: its `.db` and `.salt` and the unlock data kept elsewhere, so a hardware key
 * still works afterwards. Sync settings live inside the vault, so they follow too.
 * Returns the vault's new path.
 */
export async function renameVault(vaultPath: unknown, newName: unknown, ctx: VaultFileContext): Promise<string> {
  const from = await resolveListedVault(vaultPath, ctx);
  assertNotOpen(from, ctx, 'rename');
  if (typeof newName !== 'string' || !newName.trim()) throw new Error('Enter a name for the vault');

  const name = sanitizeVaultFilename(newName);
  const pairs = vaultFilePairs(from, name, ctx);
  const to = pairs[0][1];
  if (to === from) return from;

  // A case-only rename ("work" → "Work") is the same file on Windows and macOS.
  const caseOnly = samePath(from, to);
  if (!caseOnly && (await exists(to))) throw new Error(`A vault called "${name}" already exists`);

  const done: Array<[string, string]> = [];
  try {
    for (const [src, dest, trashStale] of pairs) {
      if (!(await exists(src))) {
        // Unlock data left behind by a vault deleted by hand would attach itself to this one.
        if (trashStale && !caseOnly && (await exists(dest))) await ctx.trash(dest);
        continue;
      }
      // A shared name that another vault's file already has: never overwrite it (#5902). This
      // vault's copy stays under its old name instead.
      if (!trashStale && !caseOnly && (await exists(dest))) continue;
      await fs.rename(src, dest);
      done.push([src, dest]);
    }
  } catch (err) {
    // Put back what was already moved, so the vault isn't left half renamed.
    for (const [src, dest] of done.reverse()) await fs.rename(dest, src).catch(() => {});
    throw err;
  }
  return to;
}

/**
 * Delete a vault: its files go to the Recycle Bin / Trash (so a mistake can be undone), along
 * with its unlock data. Copies synced to a remote backend are not touched.
 * Returns the files that were moved to the trash.
 */
export async function deleteVault(vaultPath: unknown, ctx: VaultFileContext): Promise<string[]> {
  const target = await resolveListedVault(vaultPath, ctx);
  assertNotOpen(target, ctx, 'delete');

  const files: string[] = [];
  for (const [file] of vaultFilePairs(target, vaultNameFromPath(target), ctx)) {
    if (await exists(file)) files.push(file);
  }
  // The .db goes first: if the trash refuses it, nothing else has been touched.
  for (const file of files) await ctx.trash(file);
  return files;
}
