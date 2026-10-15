import { access, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
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
function validFeatureDirectory(name) {
  const match =
    /^(\d{4})(\d{2})(\d{2})([01]\d|2[0-3])([0-5]\d)_(?:feature|fix|refactor)_[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(
      name,
    );
  if (!match) return false;
  const calendarDate = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${calendarDate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === calendarDate;
}

/**
 * Checks documentation links, final newlines and minute-stamped feature directories.
 * @param {string} root Repository root; tests use isolated temporary repositories.
 * @returns {Promise<number>} Number of Markdown files checked; rejects with all failures.
 */
export async function checkDocumentation(root = defaultRoot) {
  const failures = [];
  const features = join(root, 'docs', '04_FEATURES');
  for (const entry of await readdir(features, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!validFeatureDirectory(entry.name)) {
      failures.push(
        `${features}/${entry.name}: 功能目录必须使用有效日期与分钟的 YYYYMMDDHHmm_category_name（北京时间），category 为 feature/fix/refactor，name 为 kebab-case`,
      );
    }
    try {
      if (!(await stat(join(features, entry.name, 'spec.md'))).isFile()) {
        failures.push(`${features}/${entry.name}: 功能目录必须先建立 spec.md 文件`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      failures.push(`${features}/${entry.name}: 功能目录必须先建立 spec.md 文件`);
    }
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
  return files.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checked = await checkDocumentation();
  process.stdout.write(`Documentation checks passed (${checked} files).\n`);
}
