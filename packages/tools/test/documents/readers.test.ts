import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { executeRegistered as executeTool } from '../support/registered.js';
import type { WorkspaceToolContext } from '../../src/lib/tool-context.js';
import { extractDocument, extractPdf } from '../../src/utils/document-text.js';

const directories: string[] = [];
async function fixture(): Promise<WorkspaceToolContext> {
  const directory = await mkdtemp(join(tmpdir(), 'document-reader-'));
  directories.push(directory);
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  return {
    workspaceRoot: await realpath(workspaceRoot),
    profileDirectory,
    readOnly: true,
    signal: new AbortController().signal,
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it('returns real image bytes and rejects links, protected paths and invalid signatures', async () => {
  const context = await fixture();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=',
    'base64',
  );
  await writeFile(join(context.workspaceRoot, 'preview.png'), png);
  const result = await executeTool('view_image', { path: 'preview.png' }, context);
  expect(result.content[1]).toEqual({
    type: 'image',
    data: png.toString('base64'),
    mimeType: 'image/png',
  });
  await symlink(
    join(context.workspaceRoot, 'preview.png'),
    join(context.workspaceRoot, 'linked.png'),
  );
  await expect(executeTool('view_image', { path: 'linked.png' }, context)).rejects.toMatchObject({
    code: 'SYMLINK_PATH',
  });
  await expect(executeTool('view_image', { path: '../secret.png' }, context)).rejects.toMatchObject(
    {
      code: 'PROTECTED_PATH',
    },
  );
  await writeFile(join(context.workspaceRoot, 'oversized.png'), Buffer.alloc(6_000_001));
  await expect(executeTool('view_image', { path: 'oversized.png' }, context)).rejects.toMatchObject(
    {
      code: 'FILE_TOO_LARGE',
    },
  );
  await writeFile(join(context.workspaceRoot, 'fake.png'), 'not a PNG');
  await expect(executeTool('view_image', { path: 'fake.png' }, context)).rejects.toMatchObject({
    code: 'IMAGE_FAILED',
  });
});

it('rejects unsupported documents, malformed page requests and cancellation before launching helpers', async () => {
  const context = await fixture();
  await writeFile(join(context.workspaceRoot, 'document.docx'), 'broken zip');
  await expect(
    executeTool('read_document', { path: 'document.docx' }, context),
  ).rejects.toMatchObject({
    code: 'DOCUMENT_FAILED',
  });
  await expect(
    executeTool('view_pdf_page', { path: 'file.pdf', pages: [1, 1] }, context),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  await expect(
    executeTool('view_pdf_page', { path: 'document.docx', pages: [1] }, context),
  ).rejects.toMatchObject({ code: 'PDF_FAILED' });
  const cancelled = { ...context, signal: AbortSignal.abort() };
  await expect(executeTool('view_image', { path: 'preview.png' }, cancelled)).rejects.toMatchObject(
    {
      name: 'AbortError',
    },
  );
  await expect(extractPdf(new Uint8Array(), cancelled.signal)).rejects.toMatchObject({
    code: 'CANCELLED',
  });
  await expect(extractDocument(new Uint8Array(), 'docx', cancelled.signal)).rejects.toMatchObject({
    code: 'CANCELLED',
  });
});

const python =
  process.env['MY_PI_HARNESS_TEST_PYTHON'] ??
  fileURLToPath(new URL('../../../../.cache/office-venv/bin/python', import.meta.url));
it.skipIf(process.platform !== 'darwin' || !existsSync(python))(
  'renders stable PDF bytes in the read-only managed helper and extracts bounded body text',
  async () => {
    const context = await fixture();
    await new Promise<void>((accept, reject) => {
      execFile(
        python,
        [
          '-B',
          '-c',
          "from reportlab.pdfgen import canvas; c=canvas.Canvas('report.pdf'); c.drawString(36,750,'Readable fixture'); c.showPage(); c.save()",
        ],
        { cwd: context.workspaceRoot, timeout: 10000 },
        (error) => {
          if (error) reject(new Error('PDF fixture creation failed', { cause: error }));
          else accept();
        },
      );
    });
    const result = await executeTool(
      'view_pdf_page',
      { path: 'report.pdf', pages: [1], maxPixels: 600 },
      { ...context, pythonPath: python },
    );
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    const text = await executeTool('read_document', { path: 'report.pdf' }, context);
    const first = text.content[0];
    if (first?.type !== 'text') throw new Error('Missing extracted text');
    expect(first.text).toContain('Readable fixture');
  },
  30000,
);
