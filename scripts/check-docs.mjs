import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['node_modules', 'dist', 'out', 'release', '.cache', '.turbo']);
async function documents(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map(async (entry) => {
      if (ignored.has(entry.name)) return [];
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return documents(path);
      return entry.name.endsWith('.md') ? [path] : [];
    }),
  );
  return lists.flat();
}
const files = [
  join(root, 'README.md'),
  join(root, 'AGENTS.md'),
  ...(
    await Promise.all(
      ['docs', 'apps', 'packages'].map((directory) => documents(join(root, directory))),
    )
  ).flat(),
];
const failures = [];
for (const file of files) {
  const content = await readFile(file, 'utf8');
  if (!content.endsWith('\n') || content.endsWith('\n\n'))
    failures.push(`${file}: 末尾需要一个换行`);
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(?:https?:|mailto:|app:)/.test(target)) continue;
    try {
      await access(resolve(dirname(file), decodeURIComponent(target)));
    } catch {
      failures.push(`${file}: 无效链接 ${target}`);
    }
  }
}
if (failures.length > 0) throw new Error(failures.join('\n'));
process.stdout.write(`Documentation checks passed (${files.length} files).\n`);
