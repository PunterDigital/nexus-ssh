// ============================================================
// Nexus SSH Client — Hardware-key record names (#5902)
//
// Each vault's hardware-key unlock data is one file in
// userData/hwkey-store. Up to v0.6.0 the file was named after the
// vault's file name only (`Work.hwkey`), so two vaults called Work in
// different folders shared one record and registering a key on one
// replaced the other's. Records are now named by vault path:
// `<file name>.<hash of its folder>.hwkey`.
//
// Lookup order for a vault (see `recordCandidates`):
//   1. its own path-named record;
//   2. the old file-name record (written by v0.6.0 and earlier);
//   3. a path-named record for the same file name in another folder,
//      only when there is exactly one (the vault folder was moved).
// A record found by 2 or 3 is copied to the vault's own name after it
// has unlocked the vault once, and the old file is deleted only after
// the copy has unlocked it too (hardware-key/index.ts).
//
// No Electron imports: unit-tested, and used by vault/manage.ts.
// ============================================================

import { createHash } from 'crypto';
import path from 'path';
import { VAULT_FILE_EXTENSION } from '../../shared/constants';

export const HWKEY_EXTENSION = '.hwkey';

/** Hex characters of the folder hash in a record name. */
const HASH_LENGTH = 12;

/** The vault's file name without `.db`. */
function vaultBaseName(vaultPath: string): string {
  return path.basename(vaultPath, VAULT_FILE_EXTENSION);
}

/**
 * The vault's folder, normalised so the same folder always hashes the same: resolved, and
 * lower-cased where the file system ignores case (Windows, macOS).
 */
function normalisedFolder(vaultPath: string, platform: NodeJS.Platform): string {
  const folder = path.resolve(path.dirname(path.resolve(vaultPath)));
  return platform === 'win32' || platform === 'darwin' ? folder.toLowerCase() : folder;
}

/** Short hash of the folder a vault is in. */
export function folderHash(vaultPath: string, platform: NodeJS.Platform = process.platform): string {
  return createHash('sha256').update(normalisedFolder(vaultPath, platform), 'utf8').digest('hex').slice(0, HASH_LENGTH);
}

/** The record id (file name without `.hwkey`) a vault's hardware-key data is written under. */
export function recordId(vaultPath: string, platform: NodeJS.Platform = process.platform): string {
  return `${vaultBaseName(vaultPath)}.${folderHash(vaultPath, platform)}`;
}

/** The record id v0.6.0 and earlier used: the vault's file name only. */
export function legacyRecordId(vaultPath: string): string {
  return vaultBaseName(vaultPath);
}

/** True when `fileName` is a path-named record for a vault called `baseName` (any folder). */
export function isPathRecordFor(fileName: string, baseName: string): boolean {
  if (!fileName.startsWith(`${baseName}.`) || !fileName.endsWith(HWKEY_EXTENSION)) return false;
  const hash = fileName.slice(baseName.length + 1, -HWKEY_EXTENSION.length);
  return hash.length === HASH_LENGTH && /^[0-9a-f]+$/.test(hash);
}

/**
 * Where to look for a vault's record, best first. `storeFiles` is the store folder's listing.
 * Returns the ids that exist, in lookup order.
 */
export function recordCandidates(
  vaultPath: string,
  storeFiles: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const own = recordId(vaultPath, platform);
  const legacy = legacyRecordId(vaultPath);
  const has = (id: string) => storeFiles.includes(`${id}${HWKEY_EXTENSION}`);
  const found: string[] = [];
  if (has(own)) found.push(own);
  if (has(legacy)) found.push(legacy);
  // A record for this file name in another folder: the vault folder was moved (or copied). Only
  // used when it's the only one, since with two there is no telling which vault each belongs to.
  const elsewhere = storeFiles
    .filter((f) => isPathRecordFor(f, legacy) && f !== `${own}${HWKEY_EXTENSION}`)
    .map((f) => f.slice(0, -HWKEY_EXTENSION.length));
  if (elsewhere.length === 1) found.push(elsewhere[0]);
  return found;
}

/**
 * The store files that belong to a vault for rename and delete in the vault picker: its own
 * path-named record and the old file-name record. Records from other folders are left alone.
 */
export function recordFileNames(vaultPath: string, platform: NodeJS.Platform = process.platform): string[] {
  return [`${recordId(vaultPath, platform)}${HWKEY_EXTENSION}`, `${legacyRecordId(vaultPath)}${HWKEY_EXTENSION}`];
}
