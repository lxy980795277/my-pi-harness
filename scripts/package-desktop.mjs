import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './node-runtime.mjs';
import release from './desktop-release.cjs';
import signing from './verify-desktop-signing.cjs';

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const args = release.desktopBuildArguments(process.argv.slice(2), process.platform, process.arch);
const { mode } = release.desktopReleaseOptions(process.env, process.platform);
const project = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const config = require('./electron-builder.config.cjs');
process.stdout.write(`Building ${process.platform}/${process.arch} ${mode} desktop candidate.\n`);
await run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), ...args], {
  cwd: project,
});
const output = resolve(project, config.directories.output);
const unpacked =
  process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? 'mac-arm64'
      : 'mac'
    : `${process.platform === 'win32' ? 'win' : 'linux'}${process.arch === 'arm64' ? '-arm64' : ''}-unpacked`;
await signing.verifyDesktopApplication(
  join(output, unpacked),
  process.platform,
  config.productName,
);
if (process.argv[2] === 'installer') {
  const os = process.platform === 'darwin' ? 'mac' : 'win';
  const extension = process.platform === 'darwin' ? 'dmg' : 'exe';
  await signing.verifyDesktopInstallers([
    join(
      output,
      `My-Pi-Harness-${config.extraMetadata.version}-${os}-${process.arch}-${mode}.${extension}`,
    ),
  ]);
}
