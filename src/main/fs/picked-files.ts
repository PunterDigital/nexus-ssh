/**
 * Files the user picked in main's own open-file dialog (#5612). Paths the renderer hands back
 * for a key import must be one of these, so a renderer bug can't make main read an arbitrary
 * file into the vault. Each pick is good for one use, for 10 minutes. No Electron imports:
 * unit-tested (tests/unit/security-hardening.test.ts).
 */
import * as path from 'path';

const PICK_TTL_MS = 10 * 60 * 1000;

const picked = new Map<string, number>();

function key(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Remember the files a picker dialog returned. */
export function rememberPickedFiles(filePaths: readonly string[], now: number = Date.now()): void {
  for (const f of filePaths) picked.set(key(f), now + PICK_TTL_MS);
}

/** True (once) when `filePath` was picked in the dialog and hasn't expired. */
export function takePickedFile(filePath: string, now: number = Date.now()): boolean {
  const k = key(filePath);
  const expires = picked.get(k);
  picked.delete(k);
  return expires !== undefined && expires >= now;
}

export function forgetPickedFiles(): void {
  picked.clear();
}
