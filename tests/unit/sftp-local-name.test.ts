import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  keepBothName,
  resolveInside,
  safeLocalName,
  unsafeNameReason,
} from '../../src/main/sftp/local-name';

// #5610: a hostile SFTP server chooses the names of the files it lists. A download must
// never turn one into a path outside the folder the user picked.
describe('safeLocalName', () => {
  it('takes the last part of the remote path', () => {
    expect(safeLocalName('/home/me/report.pdf')).toBe('report.pdf');
    expect(safeLocalName('report.pdf')).toBe('report.pdf');
    expect(safeLocalName('/srv/.bashrc')).toBe('.bashrc');
    expect(safeLocalName('/srv/name with spaces.txt')).toBe('name with spaces.txt');
    expect(safeLocalName('/srv/résumé 2026.docx')).toBe('résumé 2026.docx');
  });

  const refused: [string, string, RegExp][] = [
    [
      'backslash traversal',
      '/..\\..\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\x.cmd',
      /path separator/,
    ],
    ['a backslash', '/dir/a\\b.txt', /path separator/],
    ['a drive letter', '/C:evil.txt', /path separator/],
    ['an alternate data stream', '/file.txt:hidden', /path separator/],
    ['a Windows-only bad character', '/what?.txt', /path separator|Windows/],
    ['angle brackets and a pipe', '/a<b>|c', /path separator|Windows/],
    ['NUL', '/evil\u0000.txt', /control characters/],
    ['a newline', '/evil\n.txt', /control characters/],
    ['DEL', '/evil\u007f.txt', /control characters/],
    ['"."', '/srv/.', /folder reference/],
    ['".."', '/srv/..', /folder reference/],
    ['an empty name (trailing slash)', '/srv/', /empty/],
    ['a trailing dot', '/srv/evil.', /ends with a dot or a space/],
    ['a trailing space', '/srv/evil.txt ', /ends with a dot or a space/],
    ['CON', '/CON', /reserved/],
    ['nul with an extension', '/nul.txt', /reserved/],
    ['COM1', '/com1', /reserved/],
    ['LPT9 with an extension', '/LPT9.log', /reserved/],
    ['COM superscript', '/COM¹', /reserved/],
    ['a name over 255 bytes', '/' + 'é'.repeat(130), /too long/],
  ];
  for (const [what, remote, reason] of refused) {
    it(`refuses ${what}`, () => {
      expect(() => safeLocalName(remote)).toThrow(/^Refused to download "/);
      expect(() => safeLocalName(remote)).toThrow(reason);
    });
  }

  it('keeps control characters out of the error message', () => {
    expect(() => safeLocalName('/a\nb')).toThrow('Refused to download "a?b"');
  });

  it('allows names that merely contain reserved words or dots', () => {
    for (const ok of [
      'console.log',
      'CONFIG',
      'nul-report.txt',
      'com10',
      'a..b',
      '...hidden',
      'x.tar.gz',
    ]) {
      expect(unsafeNameReason(ok)).toBeNull();
    }
  });
});

describe('resolveInside', () => {
  const dir = path.resolve('downloads-test-dir');

  it('joins a plain name directly inside the folder', () => {
    expect(resolveInside(dir, 'a.txt')).toBe(path.join(dir, 'a.txt'));
    expect(resolveInside(dir + path.sep, 'a.txt')).toBe(path.join(dir, 'a.txt'));
  });

  it('refuses anything that resolves elsewhere', () => {
    for (const bad of [
      '../a.txt',
      '..',
      '.',
      'sub/a.txt',
      path.resolve('/elsewhere/a.txt'),
    ]) {
      expect(() => resolveInside(dir, bad)).toThrow(/outside/);
    }
  });

  it('refuses a sibling folder that shares the prefix', () => {
    expect(() => resolveInside(dir, `../${path.basename(dir)}-evil/a.txt`)).toThrow(
      /outside/
    );
  });
});

describe('keepBothName', () => {
  it('numbers the copy before the extension', () => {
    const taken = new Set(['report.pdf']);
    expect(keepBothName('report.pdf', (n) => taken.has(n))).toBe('report (1).pdf');
    taken.add('report (1).pdf');
    expect(keepBothName('report.pdf', (n) => taken.has(n))).toBe('report (2).pdf');
  });

  it('numbers dot files and names without an extension at the end', () => {
    expect(keepBothName('.bashrc', () => false)).toBe('.bashrc (1)');
    expect(keepBothName('Makefile', () => false)).toBe('Makefile (1)');
    expect(keepBothName('x.tar.gz', () => false)).toBe('x.tar (1).gz');
  });
});
