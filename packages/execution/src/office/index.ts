import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ExecutionError, checkCancelled, isMissing } from '../errors.js';
import type { ExecutionContent, ExecutionContext, ExecutionResult } from '../types.js';
import {
  canonicalWorkspace,
  openRegular,
  toWorkspaceRelativePath,
  workspacePath,
} from '../workspace-path.js';
import { describeOfficeTool, validateOfficeArguments } from './catalog.js';
import { runOfficeProcess, type OfficeProcessOptions } from './process.js';

export { OFFICE_TOOL_DEFINITIONS, describeOfficeTool } from './catalog.js';
export type { OfficeProcessOptions } from './process.js';

const MAX_FILE = 33_554_432;
const imageSchema = Type.Object(
  {
    page: Type.Integer({ minimum: 1, maximum: 100 }),
    data: Type.String({ maxLength: 8_000_000, pattern: '^[A-Za-z0-9+/]*={0,2}$' }),
    mimeType: Type.Literal('image/png'),
  },
  { additionalProperties: false },
);
const reportSchema = Type.Object(
  {
    format: Type.Union([
      Type.Literal('docx'),
      Type.Literal('pdf'),
      Type.Literal('xlsx'),
      Type.Literal('pptx'),
    ]),
    validation: Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 100 }),
    notVerified: Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 100 }),
    images: Type.Optional(Type.Array(imageSchema, { maxItems: 4 })),
  },
  { additionalProperties: true },
);
const resultSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), report: reportSchema }, { additionalProperties: false }),
  Type.Object(
    {
      ok: Type.Literal(false),
      code: Type.String({ pattern: '^[A-Z_]{1,100}$' }),
      message: Type.String({ maxLength: 1000 }),
    },
    { additionalProperties: false },
  ),
]);
const officeExtensions = new Set(['docx', 'pdf', 'xlsx', 'pptx']);

function boundedReport(report: Static<typeof reportSchema>): Record<string, unknown> {
  const checks = {
    format: report.format,
    validation: report.validation,
    notVerified: report.notVerified,
  };
  if (JSON.stringify(checks).length > 20_000)
    throw new ExecutionError(
      'OFFICE_OUTPUT_LIMIT',
      'Office verification metadata exceeded its limit',
    );
  const encoded = JSON.stringify(report);
  if (encoded.length <= 60_000) return report;
  return {
    ...checks,
    truncated: true,
    preview: encoded.slice(0, 20_000),
    message:
      'Inspection details were shortened; inspect specific pages, sheets or objects separately.',
  };
}

function formatFor(path: string): string {
  const format = extname(path).slice(1).toLowerCase();
  if (!officeExtensions.has(format))
    throw new ExecutionError('OFFICE_UNSUPPORTED_FORMAT', 'Use a DOCX, PDF, XLSX or PPTX file');
  return format;
}

async function copyInput(
  root: string,
  relative: string,
  temporary: string,
  number: number,
  signal: AbortSignal,
  image = false,
): Promise<string> {
  const format = image ? extname(relative).slice(1).toLowerCase() : formatFor(relative);
  if (image && !['png', 'jpg', 'jpeg'].includes(format))
    throw new ExecutionError('OFFICE_UNSUPPORTED_FORMAT', 'DOCX images must be PNG or JPEG files');
  const limit = image ? 5_242_880 : MAX_FILE;
  const source = await workspacePath(root, relative);
  const handle = await openRegular(source, limit);
  try {
    const before = await handle.stat();
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      checkCancelled(signal);
      const chunk = await handle.read(buffer, length, buffer.length - length, length);
      if (chunk.bytesRead === 0) break;
      length += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (length > limit)
      throw new ExecutionError('FILE_TOO_LARGE', 'Office input grew beyond its size limit');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new ExecutionError('FILE_CHANGED', 'Office input changed while being copied');
    const bytes = buffer.subarray(0, length);
    const target = join(temporary, `input-${String(number)}.${format}`);
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600, signal });
    return target;
  } finally {
    await handle.close();
  }
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (cause) {
    if (isMissing(cause)) return;
    throw cause;
  }
  throw new ExecutionError(
    'FILE_EXISTS',
    'Office output must be a new file; the existing file was preserved',
  );
}

async function publishOutput(
  root: string,
  relative: string,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<void> {
  const output = await workspacePath(root, relative, true);
  await assertAbsent(output);
  const parent = dirname(output);
  const before = await lstat(parent);
  const staging = resolve(parent, `.my-pi-office-${randomUUID()}`);
  const handle = await open(
    staging,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes, { signal });
    await handle.sync();
    await handle.close();
    checkCancelled(signal);
    await workspacePath(root, relative, true);
    const after = await lstat(parent);
    if (before.dev !== after.dev || before.ino !== after.ino)
      throw new ExecutionError('FILE_CHANGED', 'The output parent directory changed');
    await link(staging, output);
  } finally {
    await handle.close();
    await rm(staging, { force: true });
  }
}

/** Execute only after the caller persisted intent and obtained the normal workspace-tool approval. */
export async function executeOfficeTool(
  name: string,
  args: Record<string, unknown>,
  context: ExecutionContext,
  options: OfficeProcessOptions = {},
): Promise<ExecutionResult> {
  validateOfficeArguments(name, args);
  const description = describeOfficeTool(name, args);
  if (context.readOnly && description.mutating)
    throw new ExecutionError(
      'READ_ONLY',
      'Office modifications are disabled by the current policy',
    );
  checkCancelled(context.signal);
  const root = await canonicalWorkspace(context);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-office-')));
  try {
    const request = structuredClone(args);
    request['tool'] = name;
    let number = 0;
    if (typeof args['source'] === 'string') {
      request['format'] = formatFor(args['source']);
      request['source'] = await copyInput(
        root,
        args['source'],
        temporary,
        number++,
        context.signal,
      );
    }
    for (const key of ['mergeSources', 'appendSources']) {
      if (!Array.isArray(args[key])) continue;
      const inputs = args[key];
      const copied: string[] = [];
      for (const input of inputs) {
        if (typeof input !== 'string')
          throw new ExecutionError('INVALID_ARGUMENTS', 'Invalid office input path');
        copied.push(await copyInput(root, input, temporary, number++, context.signal));
      }
      request[key] = copied;
    }
    if (Array.isArray(args['images'])) {
      const images: readonly unknown[] = args['images'];
      const copied = [];
      for (const image of images) {
        if (
          typeof image !== 'object' ||
          image === null ||
          !('source' in image) ||
          typeof image.source !== 'string'
        )
          throw new ExecutionError('INVALID_ARGUMENTS', 'Invalid DOCX image path');
        copied.push({
          ...image,
          source: await copyInput(root, image.source, temporary, number++, context.signal, true),
        });
      }
      request['images'] = copied;
    }
    let output: string | undefined;
    if (typeof args['output'] === 'string') {
      const expected = name === 'office_render' ? 'pdf' : name.slice('office_'.length);
      if (formatFor(args['output']) !== expected)
        throw new ExecutionError(
          'OFFICE_UNSUPPORTED_FORMAT',
          'Output extension does not match the office operation',
        );
      output = await workspacePath(root, args['output'], true);
      await assertAbsent(output);
      request['output'] = join(temporary, `result.${expected}`);
    }
    if (
      typeof args['source'] === 'string' &&
      name !== 'office_render' &&
      name !== 'office_inspect' &&
      formatFor(args['source']) !==
        (name === 'pdf_read_pages' ? 'pdf' : name.slice('office_'.length))
    )
      throw new ExecutionError(
        'OFFICE_UNSUPPORTED_FORMAT',
        'Source format does not match the office operation',
      );
    if (name === 'office_render' && request['format'] === 'pdf')
      throw new ExecutionError(
        'OFFICE_UNSUPPORTED_FORMAT',
        'Office rendering accepts DOCX, XLSX and PPTX sources',
      );
    const resources =
      options.resourceDirectory ??
      fileURLToPath(new URL('../../resources/office/', import.meta.url));
    const encoded = await runOfficeProcess(request, temporary, root, resources, context, options);
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch (cause) {
      throw new ExecutionError('OFFICE_PROCESS_FAILED', 'Office worker did not return valid JSON', {
        cause,
      });
    }
    if (!Value.Check(resultSchema, decoded))
      throw new ExecutionError('OFFICE_PROCESS_FAILED', 'Office worker returned an invalid result');
    if (!decoded.ok) {
      let message = decoded.message;
      for (const privatePath of [root, temporary, resources])
        message = message.split(privatePath).join('[workspace]');
      throw new ExecutionError(decoded.code, message);
    }
    checkCancelled(context.signal);
    const report = decoded.report;
    const images = report.images;
    delete report.images;
    const visibleReport = boundedReport(report);
    const content: ExecutionContent[] = [];
    if (output !== undefined) {
      const outputPath = request['output'];
      if (typeof outputPath !== 'string')
        throw new ExecutionError('OFFICE_PROCESS_FAILED', 'Office worker output is missing');
      const handle = await openRegular(outputPath, MAX_FILE);
      let bytes: Buffer;
      try {
        bytes = await handle.readFile({ signal: context.signal });
      } finally {
        await handle.close();
      }
      if (bytes.length === 0)
        throw new ExecutionError('OFFICE_PROCESS_FAILED', 'Office output was empty');
      const relative = toWorkspaceRelativePath(root, output);
      await publishOutput(root, relative, bytes, context.signal);
      content.push({
        type: 'text',
        text: JSON.stringify({
          artifact: {
            path: relative,
            format: report.format,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            validation: report.validation,
            notVerified: report.notVerified,
          },
          report: visibleReport,
        }),
      });
      return {
        summary: `Created ${basename(relative)} (${String(bytes.length)} bytes); inspect verification limits`,
        content,
      };
    }
    content.push({ type: 'text', text: JSON.stringify(visibleReport) });
    if (images !== undefined) {
      for (const image of images) {
        content.push({ type: 'text', text: `PDF page ${String(image.page)}` });
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
      }
    }
    return { summary: `${name}: ${String(args['source'])}`, content };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
