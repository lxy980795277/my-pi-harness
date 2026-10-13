import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const nodeVersion = (await readFile(new URL('.node-version', root), 'utf8')).trim();
if ((await readFile(new URL('.nvmrc', root), 'utf8')).trim() !== nodeVersion) {
  throw new Error('.nvmrc 与 .node-version 必须一致');
}
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
  throw new Error('根 package.json 必须包含有效版本号');
}
const target = new URL('packages/protocol/src/version.ts', root);
const content = `/** Generated from the root package.json by scripts/version.mjs. */\nexport const APP_VERSION = '${version}';\n`;
if (process.argv.includes('--write')) {
  await writeFile(target, content);
} else if ((await readFile(target, 'utf8')) !== content) {
  throw new Error(`${fileURLToPath(target)} 版本不同步，请运行 pnpm version:sync`);
}
