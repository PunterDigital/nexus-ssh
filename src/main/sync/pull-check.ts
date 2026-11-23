/**
 * Checking a pulled vault before it replaces the local one (#5611).
 *
 * Anyone who can write to the sync location (a bucket, a share, an FTP folder, or a
 * man-in-the-middle on plain FTP) can put any file there. They can't make one that opens
 * with the master password, but they could put garbage there (wiping the local vault) or an
 * older genuine copy (bringing back deleted credentials). So a pull:
 *   1. opens the download with the vault's own password first (garbage and foreign files fail),
 *   2. refuses a different vault and an older copy (`sync_generation`, bumped on every push),
 *   3. keeps the local files as `.bak`, renames the download into place, and puts the backup
 *      back if the new file then won't open.
 * No Electron or SQLCipher imports: the vault is reached through `SyncVault`, so this is
 * unit-tested with a fake (tests/unit/sync-pull-check.test.ts).
 */

import { promises as fs } from 'fs';

/** What a vault file says about itself (its `app_meta`). */
export interface VaultFileInfo {
  /** `created_at`, set once when the vault was created: the vault's identity. */
  createdAt: string | null;
  /** `sync_generation`: 0 until the first push, then one higher on every push. */
  generation: number;
}

/** The parts of the vault engine a pull needs. */
export interface SyncVault {
  /** The master password of the vault open at `dbPath`, or null if it isn't open or has none. */
  passwordFor(dbPath: string): string | null;
  /** The open vault's own info. */
  localInfo(): Promise<VaultFileInfo>;
  /** Open a vault file read-only with `password` and read its info (throws if it won't open). */
  inspect(dbPath: string, saltPath: string, password: string): Promise<VaultFileInfo>;
  lock(): void;
  unlock(dbPath: string, password: string): Promise<void>;
}

export interface PullFiles {
  dbPath: string;
  saltPath: string;
  /** The downloaded files, next to the vault. */
  tmpDb: string;
  tmpSalt: string;
}

const UNCHANGED = 'Your local vault was not changed.';

/** Why a pulled vault must not replace the local one, or null if it may. */
export function pullRefusal(local: VaultFileInfo, remote: VaultFileInfo): string | null {
  // A vault that has never synced (generation 0) may adopt the remote one: that is how a
  // second device starts (create a vault, set up sync, pull). It still had to open with
  // this vault's password.
  if (local.generation > 0 && local.createdAt && remote.createdAt !== local.createdAt) {
    return (
      `The synced file is a different vault (created ${remote.createdAt ?? 'at an unknown time'}; ` +
      `this one was created ${local.createdAt}).`
    );
  }
  if (remote.generation < local.generation) {
    return (
      `The synced vault is an older copy (sync version ${remote.generation}, this device has ` +
      `${local.generation}). Pulling it would undo later changes.`
    );
  }
  return null;
}

/**
 * Check the downloaded vault and, if it passes, swap it in. Throws with the reason when it
 * refuses; the local vault is then untouched (or restored from `.bak`) and open again.
 */
export async function verifyAndSwap(vault: SyncVault, files: PullFiles): Promise<void> {
  const { dbPath, saltPath, tmpDb, tmpSalt } = files;

  const password = vault.passwordFor(dbPath);
  if (!password) {
    throw new Error(
      'Pull needs this vault unlocked with its master password, so the download can be ' +
        `checked before it replaces anything. ${UNCHANGED}`
    );
  }

  let remote: VaultFileInfo;
  try {
    remote = await vault.inspect(tmpDb, tmpSalt, password);
  } catch {
    throw new Error(
      "The synced vault doesn't open with this vault's password: it is damaged or not this " +
        `vault. ${UNCHANGED}`
    );
  }

  const refusal = pullRefusal(await vault.localInfo(), remote);
  if (refusal) throw new Error(`${refusal} ${UNCHANGED}`);

  // An open SQLCipher handle keeps the file locked on Windows: close it for the swap.
  vault.lock();
  const bakDb = dbPath + '.bak';
  const bakSalt = saltPath + '.bak';
  try {
    await fs.copyFile(dbPath, bakDb);
    await fs.copyFile(saltPath, bakSalt);
  } catch (err) {
    await vault.unlock(dbPath, password);
    throw new Error(`Couldn't back up the local vault (${message(err)}). ${UNCHANGED}`);
  }

  try {
    // rename() replaces the target in one step; the old files stay in .bak.
    await fs.rename(tmpSalt, saltPath);
    await fs.rename(tmpDb, dbPath);
    await vault.unlock(dbPath, password);
  } catch (err) {
    await fs.copyFile(bakDb, dbPath);
    await fs.copyFile(bakSalt, saltPath);
    await vault.unlock(dbPath, password);
    throw new Error(
      `The synced vault couldn't be opened after the swap (${message(err)}). ` +
        'Your local vault was restored from its backup.'
    );
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
