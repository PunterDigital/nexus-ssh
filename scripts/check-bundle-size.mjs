#!/usr/bin/env node
// Fails when the renderer's start-up chunk grows past its budget (#2357).
//
// The entry chunk is whatever dist/renderer/index.html loads with <script type="module">; every
// other chunk is lazy (React.lazy views, the WebGL addon) and is only listed for information.
// Run after `pnpm build`: node scripts/check-bundle-size.mjs [--budget-kb 400]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'renderer');

const budgetArg = process.argv.indexOf('--budget-kb');
const budgetKb = budgetArg === -1 ? 400 : Number(process.argv[budgetArg + 1]);
if (!Number.isFinite(budgetKb) || budgetKb <= 0) {
  console.error('--budget-kb must be a positive number');
  process.exit(2);
}

const html = readFileSync(join(outDir, 'index.html'), 'utf8');
const entries = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) => m[1]);
if (entries.length === 0) {
  console.error('No <script type="module"> entry found in dist/renderer/index.html');
  process.exit(2);
}

const kb = (bytes) => (bytes / 1024).toFixed(1);
const assetsDir = join(outDir, 'assets');
const chunks = readdirSync(assetsDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ name: f, bytes: statSync(join(assetsDir, f)).size }))
  .sort((a, b) => b.bytes - a.bytes);

let entryBytes = 0;
for (const src of entries) {
  const file = join(outDir, src.replace(/^\.\//, ''));
  entryBytes += statSync(file).size;
}

console.log(`Renderer chunks (${chunks.length}):`);
for (const c of chunks) {
  const isEntry = entries.some((e) => e.endsWith(c.name));
  console.log(`  ${kb(c.bytes).padStart(8)} kB  ${c.name}${isEntry ? '  (start-up)' : ''}`);
}
console.log(`Start-up chunk: ${kb(entryBytes)} kB (budget ${budgetKb} kB)`);

if (entryBytes > budgetKb * 1024) {
  console.error(
    `Start-up chunk is over budget. Lazy-load the new code (React.lazy / import()) or raise the budget on purpose.`,
  );
  process.exit(1);
}
