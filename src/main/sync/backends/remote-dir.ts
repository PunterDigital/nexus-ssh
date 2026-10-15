/**
 * The "Remote Path" folder that the SFTP and FTP sync backends keep the vault in.
 *
 * Before #2582 the backends ignored the setting and used the login's home directory (FTP:
 * the login directory). Reads fall back to that old location while the configured folder
 * has nothing in it yet, so existing setups keep working; the next push writes the vault
 * to the configured folder.
 */

import * as path from 'path';

/**
 * Tidy the configured folder: trim, drop trailing slashes and a leading `~/` (both
 * protocols resolve relative paths against the login directory). '' means no folder.
 */
export function normaliseRemoteDir(remotePath: string | undefined): string {
  let dir = (remotePath ?? '').trim().replace(/\\/g, '/');
  if (dir === '~' || dir === '.') return '';
  dir = dir.replace(/^~\//, '').replace(/\/+$/, '');
  return dir === '' && (remotePath ?? '').trim().startsWith('/') ? '/' : dir;
}

/** Where `name` lives inside the configured folder. */
export function joinRemote(dir: string, name: string): string {
  return dir ? path.posix.join(dir, name) : name;
}

/** Each folder that has to exist for `dir`, outermost first: `/a/b` → `/a`, `/a/b`. */
export function remoteDirChain(dir: string): string[] {
  const absolute = dir.startsWith('/');
  const parts = dir.split('/').filter((p) => p !== '' && p !== '.');
  return parts.map((_, i) => (absolute ? '/' : '') + parts.slice(0, i + 1).join('/'));
}

/**
 * Resolve the remote file to read: the configured folder, or the pre-#2582 location
 * (the bare name) if only that one exists.
 */
export async function locateRemote(
  dir: string,
  name: string,
  exists: (remotePath: string) => Promise<boolean>
): Promise<string> {
  const target = joinRemote(dir, name);
  if (target === name || (await exists(target))) return target;
  return (await exists(name)) ? name : target;
}
