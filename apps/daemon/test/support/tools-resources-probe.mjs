import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import '@my-pi-harness/daemon';
import { SkillCatalog } from '@my-pi-harness/tools/skills';
import {
  BUILTIN_PLUGINS,
  BUILTIN_PLUGIN_RESOURCE_DIRECTORY,
  BUNDLED_PLUGIN_RESOURCE_DIRECTORY,
  BUILTIN_PLUGIN_SKILL_RESOURCES,
} from '@my-pi-harness/plugins';
import { nativeTool, DOCUMENT_VIEW_RESOURCE_DIRECTORY } from '@my-pi-harness/tools';
import * as protocol from '@my-pi-harness/protocol';
import { StoredToolResultSchema } from '@my-pi-harness/protocol/internal';
import { extractPdf } from '@my-pi-harness/tools/document-text';
import { collectProcess, resolveProcess } from '@my-pi-harness/sandbox/process';
import { isPublicAddress } from '@my-pi-harness/sandbox/network';

const resourceSources = {
  ...BUILTIN_PLUGIN_SKILL_RESOURCES,
  'utils/document-view/pdf_safety.py': {
    directory: DOCUMENT_VIEW_RESOURCE_DIRECTORY,
    path: 'pdf_safety.py',
  },
};

const officeScripts = [
  ['documents', 'docx_edit.py', ['documents.py', 'word_layout.py']],
  ['pdf', 'pdf_edit.py', ['pdfs.py', 'pdf_forms.py', 'pdf_layout.py']],
  ['spreadsheets', 'xlsx_check.py', ['spreadsheets.py']],
  ['presentations', 'pptx_check.py', ['presentations.py']],
];

function samplePdf() {
  const stream = 'BT /F1 12 Tf 20 100 Td (Deployed document fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(document);
}

async function main() {
  const [fixture, python] = process.argv.slice(2);
  assert.equal(typeof fixture, 'string');
  assert.equal(typeof python, 'string');
  const deployment = dirname(fileURLToPath(import.meta.url));
  for (const removed of [
    '@my-pi-harness/tools/documents',
    '@my-pi-harness/tools/registry',
    '@my-pi-harness/tools/plugins',
  ]) {
    assert.throws(() => import.meta.resolve(removed), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
  for (const specifier of [
    '@my-pi-harness/daemon',
    '@my-pi-harness/protocol',
    '@my-pi-harness/storage',
    '@my-pi-harness/agent-runtime',
    '@my-pi-harness/integrations',
    '@my-pi-harness/tools',
    '@my-pi-harness/tools/skills',
    '@my-pi-harness/plugins',
    '@my-pi-harness/protocol/internal',
    '@my-pi-harness/tools/document-text',
    '@my-pi-harness/sandbox',
    '@my-pi-harness/sandbox/process',
    '@my-pi-harness/sandbox/network',
  ]) {
    const resolved = await realpath(fileURLToPath(import.meta.resolve(specifier)));
    const path = relative(deployment, resolved);
    assert(!isAbsolute(path) && !path.startsWith('..'), `${specifier} escaped the deployment`);
    assert(
      (path.startsWith('src/') || path.includes('/src/')) && path.endsWith('.ts'),
      `${specifier} did not resolve deployed TypeScript source`,
    );
  }
  for (const resources of [
    BUILTIN_PLUGIN_RESOURCE_DIRECTORY,
    BUNDLED_PLUGIN_RESOURCE_DIRECTORY,
    DOCUMENT_VIEW_RESOURCE_DIRECTORY,
  ]) {
    const path = relative(deployment, await realpath(resources));
    assert(!isAbsolute(path) && !path.startsWith('..'), 'Bundled resources escaped the deployment');
  }
  for (const helper of ['render_pdf_pages.py', 'pdf_safety.py'])
    await access(join(DOCUMENT_VIEW_RESOURCE_DIRECTORY, helper));
  assert(StoredToolResultSchema);
  for (const name of [
    'StoredToolResultSchema',
    'FrozenSkillSchema',
    'FrozenMcpToolSchema',
    'LiveMessageDeltaSchema',
    'ProviderRecordSchema',
    'ToolContentSchema',
    'defaultAgentSettings',
  ])
    assert.equal(name in protocol, false, `${name} escaped into the public protocol`);
  assert.equal(isPublicAddress('::ffff:127.0.0.1'), false);
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
  const workspaceRoot = join(fixture, 'workspace');
  const profileDirectory = join(fixture, 'private');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  await writeFile(join(workspaceRoot, 'report.pdf'), samplePdf());
  const signal = new AbortController().signal;
  assert((await extractPdf(samplePdf(), signal)).includes('Deployed document fixture'));
  const readDocument = nativeTool('read_document');
  assert(readDocument, 'Missing deployed read_document registration');
  const result = await readDocument.bind({
    owner: { sessionId: 'deployed-session', runId: 'deployed-run', taskId: null },
    readOnly: true,
    workspace: async () => ({ workspaceRoot, profileDirectory, readOnly: true, signal }),
  })({ path: 'report.pdf' }, { toolCallId: 'deployed-read-document', signal });
  assert(
    result.content.some(
      (block) => block.type === 'text' && block.text.includes('Deployed document fixture'),
    ),
  );

  const catalog = new SkillCatalog({
    snapshotDirectory: join(profileDirectory, 'versions'),
    materializationDirectory: join(fixture, 'materialized'),
    protectedDirectories: [profileDirectory],
    resourceSources,
  });
  const frozen = [];
  for (const [id] of officeScripts) {
    assert(BUILTIN_PLUGINS.some((plugin) => plugin.id === id));
    const [skill] = await catalog.discover(
      [
        {
          path: join(BUILTIN_PLUGIN_RESOURCE_DIRECTORY, id, 'skills'),
          scope: 'plugin',
          pluginId: id,
          workspaceId: null,
          managed: false,
        },
      ],
      signal,
    );
    assert(skill, `Missing deployed ${id} Skill`);
    frozen.push(
      await catalog.freeze(skill, signal, {
        skillEpoch: 1,
        pluginId: id,
        pluginEpoch: 1,
        pluginGeneration: 'deployment-resource-fixture',
      }),
    );
  }
  const lease = await catalog.materializeBindings(frozen, signal, () => Promise.resolve());
  try {
    await lease.verify(signal);
    const runtimeRoots = [
      ...new Set([
        await realpath(dirname(dirname(python))),
        dirname(dirname(await realpath(python))),
      ]),
    ];
    const reports = [];
    for (const [index, [id, script, modules]] of officeScripts.entries()) {
      const binding = lease.bindings[index];
      assert(binding, `Missing ${id} materialization`);
      assert.equal((await stat(binding.directory)).mode & 0o222, 0);
      const manifest = JSON.parse(
        await readFile(join(binding.directory, 'resource-manifest.json'), 'utf8'),
      );
      for (const dependency of manifest.dependencies) {
        const materialized = await readFile(join(binding.directory, dependency.target));
        const source = resourceSources[dependency.source];
        assert(source, `Unregistered shared helper ${dependency.source}`);
        const bundled = await readFile(join(source.directory, source.path));
        assert(materialized.equals(bundled), `Shared helper mismatch for ${id}`);
        assert.equal(createHash('sha256').update(materialized).digest('hex'), dependency.hash);
      }
      const program = join(binding.directory, 'scripts', script);
      await access(program);
      for (const module of modules) await access(join(binding.directory, 'scripts', module));
      const launch = {
        command: python,
        workspaceRoot,
        profileDirectory,
        environment: {},
        scope: 'sandboxed',
        access: 'read-only',
        readOnlyDirectories: [...lease.readOnlyDirectories, ...runtimeRoots],
        limits: { lifetimeMs: 10_000 },
      };
      const help = await collectProcess(
        await resolveProcess({ ...launch, args: ['-B', '-s', program, '--help'] }),
        signal,
      );
      assert.equal(help.code, 0, help.stderr);
      assert(help.stdout.includes('usage:'), `No executable ${id} CLI help`);
      const dependencies = await collectProcess(
        await resolveProcess({ ...launch, args: ['-B', '-s', program, 'dependencies'] }),
        signal,
      );
      assert.equal(dependencies.code, 0, dependencies.stderr);
      const report = JSON.parse(dependencies.stdout);
      assert.equal(typeof report.ready, 'boolean');
      assert(Array.isArray(report.missingModules));
      assert(report.missingModules.every((name) => typeof name === 'string'));
      assert(report.converter === null || typeof report.converter === 'string');
      assert(report.installation.includes('downloads nothing'));
      reports.push({
        id,
        ready: report.ready,
        missingModules: report.missingModules,
        converterAvailable: report.converter !== null,
      });
    }
    console.log(
      JSON.stringify({
        packages: 'deployed-source',
        pdfText: true,
        materializedSkills: frozen.length,
        office: reports,
      }),
    );
  } finally {
    const directories = [...lease.readOnlyDirectories];
    await lease.release();
    catalog.close();
    for (const directory of directories)
      await assert.rejects(access(directory), { code: 'ENOENT' });
  }
}

await main();
