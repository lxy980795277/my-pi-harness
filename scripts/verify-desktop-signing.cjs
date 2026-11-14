const { execFile } = require('node:child_process');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { desktopSigningMode } = require('./desktop-release.cjs');

const execute = promisify(execFile);

async function verifyMac(path, notarized) {
  await execute('codesign', ['--verify', '--deep', '--strict', path]);
  const { stderr } = await execute('codesign', ['--display', '--verbose=4', path]);
  if (
    !stderr.includes('Authority=Developer ID Application:') ||
    !/TeamIdentifier=(?!not set)[A-Z0-9]+/.test(stderr)
  ) {
    throw new Error(
      'macOS release requires a verifiable Developer ID signature, not ad-hoc signing',
    );
  }
  if (notarized) await execute('xcrun', ['stapler', 'validate', path]);
  return stderr.match(/TeamIdentifier=([A-Z0-9]+)/)[1];
}

async function verifyWindows(path, recursive) {
  await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      recursive
        ? "$ErrorActionPreference = 'Stop'; $files = @(Get-ChildItem -LiteralPath $env:MY_PI_SIGN_VERIFY_PATH -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.node' }); if ($files.Count -eq 0) { throw 'No signed binaries found' }; foreach ($file in $files) { if ((Get-AuthenticodeSignature -LiteralPath $file.FullName).Status -ne 'Valid') { throw 'Desktop binary signature verification failed' } }"
        : "$ErrorActionPreference = 'Stop'; if ((Get-AuthenticodeSignature -LiteralPath $env:MY_PI_SIGN_VERIFY_PATH).Status -ne 'Valid') { throw 'Desktop installer signature verification failed' }",
    ],
    { env: { ...process.env, MY_PI_SIGN_VERIFY_PATH: path } },
  );
}

/** Verifies actual signatures after the packager exits, including when an upstream signing hook was skipped. */
async function verifyDesktopApplication(appOutDir, platform, productName) {
  const { signed } = desktopSigningMode(process.env);
  if (!signed) return;
  if (platform === 'darwin') {
    const app = join(appOutDir, `${productName}.app`);
    const appTeam = await verifyMac(app, true);
    const nodeTeam = await verifyMac(join(app, 'Contents', 'Resources', 'node', 'node'), false);
    if (nodeTeam !== appTeam)
      throw new Error('Bundled Node must be signed by the application release team');
  } else {
    await verifyWindows(appOutDir, true);
  }
}

/** Verifies final installer signatures without treating an unsigned candidate as a signed release. */
async function verifyDesktopInstallers(paths) {
  const { signed } = desktopSigningMode(process.env);
  if (!signed) return;
  for (const path of paths) {
    if (path.endsWith('.dmg')) await verifyMac(path, false);
    if (path.endsWith('.exe')) await verifyWindows(path, false);
  }
}

module.exports = { verifyDesktopApplication, verifyDesktopInstallers };
