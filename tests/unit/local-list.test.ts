import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listDrives, listLocalDir, mapLimit } from '../../src/main/fs/local-list';

// #5667: local listings stat'ed one entry at a time, and the drive list one letter at a time.

describe('mapLimit', () => {
  it('keeps input order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0, 60, 70]);
    expect(peak).toBe(3);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe('listLocalDir', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nexus-local-list-'));
    for (let i = 0; i < 300; i++) writeFileSync(path.join(dir, `file-${i}.txt`), 'x'.repeat(i));
    mkdirSync(path.join(dir, 'a folder'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists every entry with its stat', async () => {
    const entries = await listLocalDir(dir);
    expect(entries).toHaveLength(301);
    const folder = entries.find((e) => e.filename === 'a folder')!;
    expect(folder.isDirectory).toBe(true);
    expect(folder.longname.startsWith('d')).toBe(true);
    const f = entries.find((e) => e.filename === 'file-42.txt')!;
    expect(f).toMatchObject({ isDirectory: false, isSymlink: false, size: 42 });
    expect(f.modifyTime).toBeGreaterThan(0);
  });

  it('fails for a folder that does not exist', async () => {
    await expect(listLocalDir(path.join(dir, 'missing'))).rejects.toThrow();
  });
});

describe('listDrives', () => {
  const dirStat = { isDirectory: () => true, isSymbolicLink: () => false, size: 0, mtimeMs: 0, atimeMs: 0, mode: 0, mtime: new Date(0) } as unknown as Stats;

  it('stats every letter at once, and a drive that hangs is left out after the timeout', async () => {
    const started = Date.now();
    const drives = await listDrives(async (p) => {
      if (p === 'C:\\' || p === 'E:\\') return dirStat;
      if (p === 'Z:\\') return new Promise<Stats>(() => {}); // dead network share
      throw new Error('ENOENT');
    }, 200);
    expect(drives.map((d) => d.filename)).toEqual(['C:', 'E:']);
    // One timeout in total, not one per letter in turn.
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
