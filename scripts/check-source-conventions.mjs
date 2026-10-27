import { readFile, readdir } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { declarationOrderViolations } from './source-declarations.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const ignoredDirectories = new Set([
  'node_modules',
  'dist',
  'out',
  'release',
  '.cache',
  '.turbo',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
  'output',
  '.my-pi-harness',
]);
const generatedSources = new Set(['packages/protocol/src/version.ts']);
const helperDirectories = new Set(['config', 'services', 'stores', 'constants', 'hooks', 'utils']);
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;
const asyncBridge = 'apps/web/src/hooks/use-async-event.ts';
const asyncBridgeWaiver =
  '// eslint-disable-next-line @typescript-eslint/no-floating-promises -- execute handles failures and cancellation.';

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map(async (entry) => {
      if (ignoredDirectories.has(entry.name)) return [];
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && sourceExtension.test(entry.name) ? [path] : [];
    }),
  );
  return lists.flat();
}

function literalText(node) {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return undefined;
}

function esmSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return literalText(node.moduleSpecifier);
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return literalText(node.argument.literal);
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return literalText(node.arguments[0]);
  }
  return undefined;
}

function lineCount(content) {
  if (content.length === 0) return 0;
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return normalized.split('\n').length - Number(normalized.endsWith('\n'));
}

function isKebabFilename(name) {
  const stem = name.replace(sourceExtension, '');
  return /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(stem);
}

function isStyleSpecifier(specifier) {
  return /\.(?:css|scss)(?:\?.*)?$/.test(specifier);
}

function lintDirectives(content, source) {
  const literals = [];
  function collect(node) {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isJsxText(node) ||
      [
        ts.SyntaxKind.TemplateHead,
        ts.SyntaxKind.TemplateMiddle,
        ts.SyntaxKind.TemplateTail,
      ].includes(node.kind)
    ) {
      literals.push({ start: node.getStart(source), end: node.end });
      return;
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
  literals.sort((left, right) => left.start - right.start);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, content);
  const directives = [];
  let literalIndex = 0;
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const position = scanner.getTokenPos();
    while (literals[literalIndex]?.end <= position) literalIndex += 1;
    const literal = literals[literalIndex];
    if (literal && literal.start <= position) {
      scanner.setTextPos(literal.end);
      token = scanner.scan();
      continue;
    }
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const text = scanner.getTokenText();
      if (/eslint-(?:disable|enable)/.test(text)) {
        directives.push({ text, end: scanner.getTextPos() });
      }
    }
    token = scanner.scan();
  }
  return directives;
}

function importedNames(source) {
  const names = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.name) names.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      names.add(clause.namedBindings.name.text);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) names.add(element.name.text);
    }
  }
  return names;
}

function isReexport(statement, imports) {
  if (!ts.isExportDeclaration(statement)) return false;
  if (statement.moduleSpecifier) return true;
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return false;
  return statement.exportClause.elements.some((element) => {
    return imports.has((element.propertyName ?? element.name).text);
  });
}

function isHelperIndex(path) {
  const segments = path.slice('apps/web/src/'.length).split('/');
  return (
    /^index\.[cm]?[jt]sx?$/.test(segments.at(-1)) &&
    segments.slice(0, -1).some((segment) => helperDirectories.has(segment))
  );
}

/**
 * Reads source files and rejects filename, component-directory and ESM-import violations.
 * Generated-source exceptions are explicit paths; output directories are never inspected.
 * @param {string} repoRoot Repository to inspect; tests supply isolated on-disk fixtures.
 * @returns {Promise<number>} Number of inspected source files; rejects with all diagnostics.
 */
export async function checkSourceConventions(repoRoot = defaultRoot) {
  const failures = [];
  const files = await sourceFiles(repoRoot);
  let checked = 0;

  for (const file of files) {
    const path = relative(repoRoot, file).replaceAll('\\', '/');
    if (generatedSources.has(path)) continue;
    checked += 1;
    const content = await readFile(file, 'utf8');
    const report = (message) => {
      failures.push(`${path}: ${message}`);
    };

    if (lineCount(content) > 1_000) report('源码文件超过 1000 行，必须按职责拆分');
    if (!isKebabFilename(basename(file))) report('源文件名必须使用 kebab-case');
    if (path.split('/').includes('types') && /-view\.[cm]?[jt]sx?$/.test(basename(file))) {
      report('types 文件使用领域名，不添加冗余 -view 后缀');
    }

    const webSource = path.startsWith('apps/web/src/');
    const webModule = webSource || path.startsWith('apps/web/test/');
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    if (/^(?:apps|packages)\/[^/]+\/src\/.+\.[cm]?tsx?$/.test(path)) {
      for (const diagnostic of declarationOrderViolations(source)) {
        report(`${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`);
      }
    }
    if (webSource) {
      const directives = lintDirectives(content, source);
      for (const directive of directives) {
        const nextLine = content
          .slice(directive.end)
          .match(/^\r?\n([^\r\n]*)/)?.[1]
          ?.trim();
        if (
          path !== asyncBridge ||
          directives.length !== 1 ||
          directive.text !== asyncBridgeWaiver ||
          nextLine !== 'execute(...arguments_);'
        ) {
          report(
            'Web 禁止局部关闭 ESLint；只允许 use-async-event.ts 的单条已处理 Promise 启动例外',
          );
        }
      }
    }
    if (webSource && path.endsWith('.tsx') && path !== 'apps/web/src/main.tsx') {
      if (basename(file) !== 'index.tsx') report('Web 组件必须使用独立目录中的 index.tsx');
    }

    let sawStyle = false;
    const imports = importedNames(source);
    for (const statement of source.statements) {
      if (webSource && ts.isImportDeclaration(statement)) {
        const specifier = literalText(statement.moduleSpecifier);
        if (specifier && isStyleSpecifier(specifier)) sawStyle = true;
        else if (sawStyle) report('Web 样式 import 必须置于其他 import 之后');
      }
      if (webSource && isHelperIndex(path) && isReexport(statement, imports)) {
        report('config/services/stores/constants/hooks/utils 禁止 index 聚合导出');
      }
    }

    function inspect(node) {
      const specifier = esmSpecifier(node);
      const localModule = specifier?.startsWith('.') || specifier?.startsWith('@/');
      if (webModule && localModule && /\.[cm]?[jt]sx?(?:\?.*)?$/.test(specifier)) {
        report(`Web 模块 import 不写源码或编译扩展；样式和静态资源保留实际扩展 (${specifier})`);
      } else if (
        !webModule &&
        specifier?.startsWith('.') &&
        !/\.(?:[cm]?js|json|css|scss)(?:\?.*)?$/.test(specifier)
      ) {
        report(
          `相对 ESM import 必须写 .js 扩展；原生 .mjs/.cjs、JSON 和样式保留显式扩展 (${specifier})`,
        );
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }

  if (failures.length > 0) throw new Error(failures.join('\n'));
  return checked;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checked = await checkSourceConventions();
  process.stdout.write(`Source conventions passed (${checked} files).\n`);
}
