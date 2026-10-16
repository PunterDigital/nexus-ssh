import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// #2374: every icon comes from Lucide via <Icon>. Hand-drawn <svg> icons drifted in size, stroke and
// alignment, so the renderer may only contain <svg> elements marked data-logo (brand logos Lucide
// doesn't ship), and no emoji stand-ins for icons.
const RENDERER = path.resolve(__dirname, '../../src/renderer');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const files = sourceFiles(RENDERER).map((file) => ({
  file: path.relative(RENDERER, file),
  source: readFileSync(file, 'utf8'),
}));

describe('icons', () => {
  it('has no hand-drawn <svg> icons (only data-logo brand logos)', () => {
    const offenders = files.flatMap(({ file, source }) =>
      [...source.matchAll(/<svg\b[^>]*>/g)]
        .filter((m) => !/\bdata-logo\b/.test(m[0]))
        .map((m) => `${file}:${source.slice(0, m.index).split('\n').length}`),
    );
    expect(offenders).toEqual([]);
  });

  it('uses no emoji as icons', () => {
    // Pictographs plus the gear / gear-variant code points the SFTP file list used to show.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2699}]|\\u[dD]83[cdeCDE]/u;
    const offenders = files.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, i) => ({ line, i }))
        // A placeholder in the group form invites users to type their own emoji; that's data, not an icon.
        .filter(({ line }) => emoji.test(line) && !/placeholder=/.test(line))
        .map(({ i }) => `${file}:${i + 1}`),
    );
    expect(offenders).toEqual([]);
  });

  it('renders icons through the shared <Icon> wrapper, not Lucide components directly', () => {
    const offenders = files
      .filter(({ file }) => file !== path.join('components', 'common', 'Icon.tsx'))
      .flatMap(({ file, source }) => {
        const imported = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)]
          .flatMap((m) => m[1].split(','))
          .map((s) => s.replace(/\btype\b/, '').trim())
          .filter(Boolean);
        return imported.filter((name) => new RegExp(`<${name}[\\s/>]`).test(source)).map((name) => `${file}: <${name}>`);
      });
    expect(offenders).toEqual([]);
  });
});
