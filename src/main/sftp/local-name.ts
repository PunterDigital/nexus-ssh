/**
 * Local file names for SFTP downloads (#5610).
 *
 * The remote server chooses file names, so a hostile or compromised server can list a
 * file called `..\..\AppData\Roaming\…\Startup\x.cmd` (backslashes are legal in SFTP
 * names). Main builds the local name itself from the remote path, refuses anything
 * that isn't one plain file name on every OS, and checks the result stays inside the
 * folder the user chose. No Electron imports: unit-tested in tests/unit.
 */

import * as path from 'path';

/** Windows device names: refused with or without an extension ("CON", "nul.txt"). */
const RESERVED =
  /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)(\..*)?$/i;

/** Characters Windows refuses in a file name, plus both separators. */
const FORBIDDEN_CHARS = /[\\/:*?"<>|]/;

/** Most file systems cap a name at 255 bytes. */
const MAX_NAME_BYTES = 255;

/**
 * The local file name for a download of `remotePath`: its last `/`-separated part,
 * refused (throws, with the reason) unless it is one plain file name.
 */
export function safeLocalName(remotePath: string): string {
  const name = remotePath.split('/').pop() ?? '';
  const reason = unsafeNameReason(name);
  if (reason) throw new Error(`Refused to download "${printable(name)}": ${reason}.`);
  return name;
}

/** Why `name` can't be used as a local file name, or null if it can. */
export function unsafeNameReason(name: string): string | null {
  if (name === '') return 'the name is empty';
  if (name === '.' || name === '..') return 'the name is a folder reference';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return 'the name contains control characters';
  if (FORBIDDEN_CHARS.test(name))
    return 'the name contains a path separator or a character Windows does not allow (\\ / : * ? " < > |)';
  if (/[. ]$/.test(name)) return 'the name ends with a dot or a space';
  if (RESERVED.test(name)) return 'the name is a reserved Windows device name';
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) return 'the name is too long';
  return null;
}

/**
 * `dir` joined with `name`, checked to be directly inside `dir` (throws otherwise).
 * `name` should already have passed `safeLocalName`; this is the second line of defence.
 */
export function resolveInside(dir: string, name: string): string {
  const base = path.resolve(dir);
  const target = path.resolve(base, name);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!target.startsWith(prefix) || path.dirname(target) !== base) {
    throw new Error(
      `Refused to download "${printable(name)}": it would be saved outside ${base}.`
    );
  }
  return target;
}

/**
 * The "Keep both" name for `name` in `dir`: `report (1).pdf`, `report (2).pdf`, …,
 * the first one `exists` says is free.
 */
export function keepBothName(
  name: string,
  exists: (candidate: string) => boolean
): string {
  // extname('.bashrc') is '', so dot files keep their whole name as the stem.
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`No free name for a copy of "${printable(name)}".`);
}

/** The name with control characters shown as `?`, for error messages. */
function printable(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x1f\x7f]/g, '?');
}
