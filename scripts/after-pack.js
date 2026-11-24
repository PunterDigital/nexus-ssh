// electron-builder afterPack hook.
// 1. Electron fuses (#5612), flipped here rather than through electron-builder's `electronFuses`
//    option, which runs after this hook and would break the macOS ad-hoc signature below.
// 2. macOS: ad-hoc sign the app before it is packed into the DMG. electron-builder 25 couldn't
//    ad-hoc sign itself (it treats identity '-' as a keychain name and skips), and an app whose
//    signature seal is broken won't open on Apple Silicon.
const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Off: running the app as plain Node (ELECTRON_RUN_AS_NODE) and NODE_OPTIONS, so a local
 * process can't use the installed, trusted binary as a Node interpreter or inject code into it.
 * The `--inspect` switches stay on: Playwright attaches to the main process through them, and
 * the packaged-app E2E in CI needs that (a test profile is still required to reach the
 * test hooks). Asar integrity: electron-builder writes the app.asar hash into the .exe
 * resources / Info.plist before this hook, and Electron refuses a changed app.asar.
 */
const FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableCookieEncryption: true,
  enableNodeCliInspectArguments: true,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  grantFileProtocolExtraPrivileges: false,
};

exports.default = async function afterPack(context) {
  const fuseConfig = await context.packager.generateFuseConfig(FUSES);
  await context.packager.addElectronFuses(context, fuseConfig);

  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
