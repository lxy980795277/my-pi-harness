import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { checkCancelled } from '@my-pi-harness/sandbox';
import { resolveProcess, startProcess } from '@my-pi-harness/sandbox/process';
import { resolvePythonRuntime } from '../lib/python-runtime.js';
import { DocumentError } from '../utils/document-text.js';
import { readDocumentInput } from '../lib/document-input.js';
import { completeToolRegistration } from '../lib/tool-registry.js';

const parameters = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 2000 }),
    pages: Type.Array(Type.Integer({ minimum: 1, maximum: 100 }), {
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
    }),
    maxPixels: Type.Optional(Type.Integer({ minimum: 320, maximum: 2000 })),
  },
  { additionalProperties: false },
);

const renderedSchema = Type.Object(
  {
    images: Type.Array(
      Type.Object(
        {
          page: Type.Integer({ minimum: 1, maximum: 100 }),
          data: Type.String({ maxLength: 5_333_336, pattern: '^[A-Za-z0-9+/]*={0,2}$' }),
          mimeType: Type.Literal('image/png'),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 4 },
    ),
  },
  { additionalProperties: false },
);

/** Render stable PDF bytes with a fixed read-only helper and close its process before returning. */
export const viewPdfPageTool = completeToolRegistration({
  name: 'view_pdf_page',
  description:
    'Render one to four selected PDF pages as actual images using installed Python dependencies; no OCR.',
  parameters,
  scope: 'workspace',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.images,
  async execute(ports, args, invocation) {
    const context = await ports.workspace(invocation.signal);
    const bytes = await readDocumentInput(args.path, context, 33_554_432);
    if (bytes.subarray(0, 5).toString() !== '%PDF-')
      throw new DocumentError('PDF_FAILED', 'PDF header is missing');
    const python = await pythonProgram(context.pythonPath);
    const script = fileURLToPath(
      new URL('../../resources/shared/document-view/render_pdf_pages.py', import.meta.url),
    );
    const launch = await resolveProcess({
      command: python,
      args: [
        '-B',
        '-s',
        script,
        '--stdin-bytes',
        String(bytes.length),
        '--pages',
        ...args.pages.map(String),
        '--max-pixels',
        String(args.maxPixels ?? 1600),
      ],
      workspaceRoot: context.workspaceRoot,
      profileDirectory: context.profileDirectory,
      scope: 'sandboxed',
      access: 'read-only',
      readOnlyDirectories: [
        dirname(script),
        ...(await resolvePythonRuntime(python, context.signal)).readOnlyDirectories,
      ],
      environment: {},
      limits: {
        stdoutBytes: 24_000_000,
        stdoutBurstBytes: 24_000_000,
        stdoutBytesPerSecond: 24_000_000,
        queuedWriteBytes: 33_554_432,
        stderrBytes: 100_000,
        lifetimeMs: 60_000,
      },
    });
    const output: Buffer[] = [];
    let fault: Error | undefined;
    const child = await startProcess(
      launch,
      {
        stdout: (chunk) => output.push(Buffer.from(chunk)),
        stdoutEnd: () => {},
        fault: (error) => {
          fault = error;
        },
      },
      context.signal,
    );
    try {
      await child.write(bytes, { signal: context.signal });
      const exit = await child.exit;
      await child.closed;
      checkCancelled(context.signal);
      if (fault) throw fault;
      if (exit.code !== 0)
        throw new DocumentError(
          'PDF_FAILED',
          `PDF rendering failed: ${child.diagnostics().slice(0, 1500) || 'verify Python pypdf, pypdfium2 and Pillow dependencies'}`,
        );
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.concat(output).toString('utf8'));
      } catch (cause) {
        throw new DocumentError('PDF_FAILED', 'PDF renderer returned invalid JSON', { cause });
      }
      if (!Value.Check(renderedSchema, decoded))
        throw new DocumentError('PDF_FAILED', 'PDF renderer returned invalid images');
      if (
        decoded.images.length !== args.pages.length ||
        decoded.images.some(
          (image, index) =>
            image.page !== args.pages[index] ||
            !Buffer.from(image.data, 'base64')
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        )
      )
        throw new DocumentError(
          'PDF_FAILED',
          'PDF renderer pages or PNG bytes do not match the request',
        );
      return {
        summary: `Viewed ${args.pages.length} PDF page(s) from ${args.path}`,
        content: decoded.images.flatMap((image) => [
          { type: 'text' as const, text: `PDF page ${image.page}` },
          { type: 'image' as const, data: image.data, mimeType: image.mimeType },
        ]),
      };
    } finally {
      await child.close();
    }
  },
});

async function pythonProgram(configured: string | undefined): Promise<string> {
  if (configured !== undefined && !isAbsolute(configured))
    throw new DocumentError('DEPENDENCY_MISSING', 'Python must be an absolute executable path');
  for (const candidate of configured === undefined
    ? ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']
    : [configured]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // An unavailable interpreter candidate permits checking the next installation location.
    }
  }
  throw new DocumentError('DEPENDENCY_MISSING', 'Python 3 is unavailable; prepare it explicitly');
}
