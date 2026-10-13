const { version } = require('../../package.json');

module.exports = {
  appId: 'com.liuxinyu.my-pi-harness',
  productName: 'My Pi Harness',
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
  mac: { category: 'public.app-category.developer-tools', target: ['dir'], identity: null },
  win: { target: ['dir'] },
  linux: { target: ['dir'] },
};
