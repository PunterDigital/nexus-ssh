/**
 * The SFTP browser's local listings (#5667). No Electron imports: unit-tested
 * (tests/unit/local-list.test.ts).
 *
 * A folder used to be listed with one `lstat` at a time, and the Windows drive list stat'ed
 * A: to Z: in turn, so one dead network drive held the whole call. Now the stats run in
 * parallel (a bounded number at once) and each drive gets a short timeout.
 */

import { promises as fs, type Stats } from 'fs';
import * as path from 'path';

export interface LocalFSEntry {
  filename: string;
  longname: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modifyTime: number;
  accessTime: number;
  permissions: number;
  owner: number;
  group: number;
}

/** How many `lstat` calls a listing keeps in flight. */
export const LSTAT_CONCURRENCY = 64;
/** A drive that doesn't answer a stat within this is left out (dead network share). */
export const DRIVE_STAT_TIMEOUT_MS = 1500;

/** `fn` over `items`, at most `limit` at once, results in input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function formatLongname(name: string, stat: Stats): string {
  const type = stat.isDirectory() ? 'd' : '-';
  const date = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
  return `${type}rwxr-xr-x 1 user group ${String(stat.size).padStart(10)} ${date} ${name}`;
}

function toEntry(name: string, stat: Stats): LocalFSEntry {
  return {
    filename: name,
    longname: formatLongname(name, stat),
    isDirectory: stat.isDirectory(),
    isSymlink: stat.isSymbolicLink(),
    size: stat.size,
    modifyTime: Math.floor(stat.mtimeMs / 1000),
    accessTime: Math.floor(stat.atimeMs / 1000),
    permissions: stat.mode,
    owner: stat.uid ?? 0,
    group: stat.gid ?? 0,
  };
}

/** A local folder's entries, in `readdir` order. Entries that can't be stat'ed are skipped. */
export async function listLocalDir(dirPath: string): Promise<LocalFSEntry[]> {
  const resolved = path.resolve(dirPath);
  const names = await fs.readdir(resolved);
  const entries = await mapLimit(names, LSTAT_CONCURRENCY, async (name) => {
    try {
      return toEntry(name, await fs.lstat(path.join(resolved, name)));
    } catch {
      return null; // permission denied, removed meanwhile, …
    }
  });
  return entries.filter((e): e is LocalFSEntry => e !== null);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Windows drives (A: to Z:) that answer a stat, all checked at once. */
export async function listDrives(
  stat: (p: string) => Promise<Stats> = (p) => fs.stat(p),
  timeoutMs: number = DRIVE_STAT_TIMEOUT_MS,
): Promise<LocalFSEntry[]> {
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  const found = await Promise.all(
    letters.map(async (letter) => {
      try {
        const s = await withTimeout(stat(`${letter}:\\`), timeoutMs);
        if (!s.isDirectory()) return null;
        const entry = toEntry(`${letter}:`, s);
        return {
          ...entry,
          longname: `drwxr-xr-x 1 user group          0 - ${letter}:`,
          isSymlink: false,
          size: 0,
          owner: 0,
          group: 0,
        };
      } catch {
        return null; // not present, or not answering
      }
    }),
  );
  return found.filter((e): e is LocalFSEntry => e !== null);
}
