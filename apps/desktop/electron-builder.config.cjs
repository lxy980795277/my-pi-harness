const { version } = require('../../package.json');
const { desktopReleaseOptions } = require('../../scripts/desktop-release.cjs');
const release = desktopReleaseOptions(process.env, process.platform);

module.exports = {
  appId: 'com.liuxinyu.my-pi-harness',
  productName: 'My Pi Harness',
  artifactName: `My-Pi-Harness-\${version}-\${os}-\${arch}-${release.mode}.\${ext}`,
  forceCodeSigning: release.signed,
  directories: { output: '../../release' },
  files: ['dist/**', 'package.json'],
  extraMetadata: { version },
  extraResources: [
    { from: '../../out/desktop-resources/daemon', to: 'daemon', filter: ['**/*'] },
    {
      from: '../../out/desktop-resources/daemon/node_modules',
      to: 'daemon/node_modules',
      filter: ['**/*'],
    },
    { from: '../../out/desktop-resources/web', to: 'web', filter: ['**/*'] },
    { from: '../../out/desktop-resources/node', to: 'node', filter: ['**/*'] },
  ],
  mac: { category: 'public.app-category.developer-tools', target: ['dmg'], ...release.mac },
  dmg: { sign: release.signed },
  win: { target: ['nsis'], ...release.win },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
  linux: { target: ['dir'] },
};
