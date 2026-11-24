// Checks a packaged app.asar (#5665): no source maps, no renderer-only packages (Vite bundles
// them into dist/renderer), and the runtime pieces main needs are there. Prints size and file
// count. Usage: node scripts/check-asar.mjs <path to app.asar>
import { readFileSync, statSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-asar.mjs <app.asar>');
  process.exit(2);
}

// asar layout: a Pickle holding the header size, then a Pickle holding the header JSON string.
const buf = readFileSync(file);
const headerPickleSize = buf.readUInt32LE(4);
const jsonLength = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + jsonLength).toString('utf8'));

const files = [];
(function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const p = `${prefix}/${name}`;
    if (child.files) walk(child, p);
    else files.push(p);
  }
})(header, '');

const problems = [];
const maps = files.filter((f) => f.endsWith('.map'));
if (maps.length) problems.push(`${maps.length} .map files, e.g. ${maps.slice(0, 3).join(', ')}`);

const rendererOnly = ['react', 'react-dom', 'lucide-react', 'zustand', 'uuid', '@xterm'];
for (const pkg of rendererOnly) {
  const hit = files.find((f) => f.startsWith(`/node_modules/${pkg}/`));
  if (hit) problems.push(`renderer-only package in the asar: ${pkg} (${hit})`);
}

const needed = [
  '/dist/main/index.js',
  '/dist/main/kdf/kdf-worker.js',
  '/dist/main/preload.js',
  '/dist/renderer/index.html',
  '/node_modules/libsodium-wrappers-sumo/package.json',
  '/node_modules/@journeyapps/sqlcipher/package.json',
  '/node_modules/electron-updater/package.json',
  '/node_modules/ssh2/package.json',
  '/node_modules/basic-ftp/package.json',
  '/node_modules/@aws-sdk/client-s3/package.json',
];
for (const f of needed) if (!files.includes(f)) problems.push(`missing ${f}`);

console.log(
  `${file}: ${(statSync(file).size / 1e6).toFixed(1)} MB, ${files.length} files, header ${(headerPickleSize / 1e3).toFixed(0)} kB`,
);
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('  ok: no source maps, no renderer-only packages, runtime modules present');
