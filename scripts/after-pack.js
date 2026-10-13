// electron-builder afterPack hook: ad-hoc sign the macOS app before it is packed into the DMG.
// electron-builder 25 can't ad-hoc sign itself (it treats identity '-' as a keychain name and skips),
// and an app whose signature seal is broken won't open on Apple Silicon.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
