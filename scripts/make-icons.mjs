// Renders resources/icon.svg into the icons electron-builder picks up from resources/
// (its buildResources): icon.png (1024²), icon.ico (Windows, 16–256) and icon.icns (macOS).
// sharp and png2icons aren't project dependencies. Install them in any scratch folder and run
// the script from there, so pnpm's node_modules stays untouched:
//   mkdir /tmp/icon-tools && cd /tmp/icon-tools && npm i sharp png2icons
//   node /path/to/nexus-ssh/scripts/make-icons.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const png2icons = require('png2icons');

const dir = path.join(import.meta.dirname, '..', 'resources');
const png = await sharp(path.join(dir, 'icon.svg'), { density: 300 }).resize(1024, 1024).png().toBuffer();
fs.writeFileSync(path.join(dir, 'icon.png'), png);
fs.writeFileSync(path.join(dir, 'icon.ico'), png2icons.createICO(png, png2icons.BICUBIC2, 0, false, true));
fs.writeFileSync(path.join(dir, 'icon.icns'), png2icons.createICNS(png, png2icons.BICUBIC2, 0));
for (const f of ['icon.png', 'icon.ico', 'icon.icns']) console.log(f, fs.statSync(path.join(dir, f)).size, 'bytes');
