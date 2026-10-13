import { readFile, readdir } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['node_modules', 'dist', 'out', 'release', '.cache', '.turbo', '.git']);
const serverPackages = new Set(['fastify', 'better-sqlite3', 'drizzle-orm']);

async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map(async (entry) => {
      if (ignored.has(entry.name)) return [];
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return lists.flat();
}

function repositoryPath(repoRoot, file) {
  return relative(repoRoot, file).replaceAll('\\', '/');
}

function packageName(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0];
}

function workspaceOwner(path) {
  return /^(?:apps|packages)\/[^/]+(?=\/|$)/.exec(path)?.[0];
}

/** Returns a diagnostic for a forbidden import without resolving build outputs. */
export function importViolation(file, specifier, repoRoot = root) {
  const path = repositoryPath(repoRoot, file);
  const owner = workspaceOwner(path);
  const localTarget = specifier.startsWith('.')
    ? repositoryPath(repoRoot, resolve(dirname(file), specifier))
    : null;

  if (owner && localTarget) {
    const targetOwner = workspaceOwner(localTarget);
    if (targetOwner && targetOwner !== owner) {
      if (owner.startsWith('apps/') && targetOwner.startsWith('apps/')) {
        return '应用间不能导入业务源码';
      }
      return '跨工作区导入必须使用包名，不能引用另一工作区的源码';
    }
  }

  if (/^@my-pi-harness\/protocol\//.test(specifier)) {
    return '公共协议必须从显式 exports 导入';
  }

  const isHostDependency =
    isBuiltin(specifier) ||
    specifier.startsWith('node:') ||
    /^(?:electron(?:\/|$)|@earendil-works\/|@fastify\/)/.test(specifier) ||
    serverPackages.has(packageName(specifier));

  if (path.startsWith('apps/web/src/')) {
    const isWorkspaceImplementation =
      specifier.startsWith('@my-pi-harness/') && specifier !== '@my-pi-harness/protocol';
    if (isHostDependency || isWorkspaceImplementation) {
      return 'Renderer 只能使用浏览器安全模块';
    }
  }

  if (path.startsWith('packages/protocol/src/')) {
    const isOwnModule = localTarget?.startsWith('packages/protocol/');
    const isSchemaLibrary = specifier === 'typebox' || specifier.startsWith('typebox/');
    if (!isOwnModule && !isSchemaLibrary) {
      return '公共协议不能依赖宿主或业务实现';
    }
  }

  if (
    path.startsWith('apps/desktop/src/') &&
    /^@my-pi-harness\/(?:daemon|agent-runtime)(?:\/|$)/.test(specifier)
  ) {
    return '桌面主进程不能导入 Runtime 业务';
  }

  return null;
}

function literalText(node) {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return undefined;
}

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return literalText(node.moduleSpecifier);
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return literalText(node.argument.literal);
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return literalText(node.moduleReference.expression);
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  ) {
    return literalText(node.arguments[0]);
  }
  return undefined;
}

/**
 * Reads workspace source files and rejects imports that cross declared process ownership.
 * @param {string} repoRoot Repository to inspect; tests use isolated on-disk fixtures.
 * @returns {Promise<number>} Number of source files checked; rejects with all violations.
 */
export async function checkBoundaries(repoRoot = root) {
  const failures = [];
  const directories = await Promise.all([
    sources(join(repoRoot, 'apps')),
    sources(join(repoRoot, 'packages')),
  ]);
  const files = directories.flat();
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    function inspect(node) {
      const specifier = moduleSpecifier(node);
      if (specifier) {
        const violation = importViolation(file, specifier, repoRoot);
        if (violation)
          failures.push(`${repositoryPath(repoRoot, file)}: ${violation} (${specifier})`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return files.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fileCount = await checkBoundaries();
  process.stdout.write(`Import checks passed (${fileCount} source files).\n`);
}
