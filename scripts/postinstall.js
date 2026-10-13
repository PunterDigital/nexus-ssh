#!/usr/bin/env node

// ============================================================
// Nexus SSH Client — Post-install Script
// Rebuilds only @journeyapps/sqlcipher for Electron's ABI.
// Falls back gracefully if Visual Studio Build Tools are missing.
// ============================================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODULES_TO_REBUILD = ['@journeyapps/sqlcipher'];

function hasVisualStudio() {
  if (process.platform !== 'win32') return true; // Not needed on macOS/Linux with Xcode/gcc
  try {
    // Check for VS Build Tools via vswhere
    execSync(
      '"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -property installationPath',
      { stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

function tryRebuild() {
  const only = MODULES_TO_REBUILD.map((m) => `--only ${m}`).join(' ');
  try {
    console.log(`\n🔧 Rebuilding native modules for Electron: ${MODULES_TO_REBUILD.join(', ')}`);
    execSync(`electron-rebuild -f ${only}`, {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    });
    console.log('✅ Native modules rebuilt successfully.\n');
    return true;
  } catch (err) {
    return false;
  }
}

function tryPrebuilt() {
  // @journeyapps/sqlcipher is an N-API module (napi-v6), so the prebuilt binary that
  // node-pre-gyp downloads at install time works in Electron without a rebuild.
  try {
    const pkgDir = path.dirname(require.resolve('@journeyapps/sqlcipher/package.json'));
    const bindingDir = path.join(pkgDir, 'lib', 'binding');
    const found = fs
      .readdirSync(bindingDir, { recursive: true })
      .find((f) => String(f).endsWith('.node'));
    if (!found) return false;
    console.log(`✅ Found prebuilt sqlcipher binding at: ${path.join(bindingDir, String(found))}\n`);
    return true;
  } catch {
    return false;
  }
}

function main() {
  // Skip rebuild in CI if SKIP_NATIVE_REBUILD is set
  if (process.env.SKIP_NATIVE_REBUILD) {
    console.log('⏭️  SKIP_NATIVE_REBUILD set, skipping native module rebuild.');
    return;
  }

  // First check if prebuilt binaries are already in place
  if (tryPrebuilt()) {
    console.log('ℹ️  Prebuilt binaries found. Skipping rebuild.');
    return;
  }

  // Check for build tools
  if (!hasVisualStudio()) {
    console.log('\n⚠️  Visual Studio Build Tools not found.');
    console.log('   SQLCipher native module needs to be compiled.');
    console.log('');
    console.log('   To install build tools, run one of:');
    console.log('');
    console.log('     Option 1 (recommended): Install Visual Studio Build Tools');
    console.log('       https://visualstudio.microsoft.com/visual-cpp-build-tools/');
    console.log('       Select "Desktop development with C++" workload');
    console.log('');
    console.log('     Option 2: Use winget');
    console.log('       winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"');
    console.log('');
    console.log('   After installing, run: pnpm rebuild');
    console.log('');
    console.log('   The app will not be able to open encrypted vaults until sqlcipher is built.\n');
    return;
  }

  // Build tools available — try rebuild
  if (!tryRebuild()) {
    console.log('\n⚠️  Failed to rebuild native modules.');
    console.log('   Run "pnpm rebuild" after resolving the issue.\n');
  }
}

main();
