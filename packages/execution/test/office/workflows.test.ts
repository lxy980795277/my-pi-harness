import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { runOfficeProcess } from '../../src/office/process.js';
import { executeOfficeTool } from '../../src/office/executor.js';
import type { ExecutionContext, ExecutionResult } from '../../src/core/types.js';

const python =
  process.env['MY_PI_HARNESS_OFFICE_TEST_PYTHON'] ??
  fileURLToPath(new URL('../../../../.cache/office-venv/bin/python', import.meta.url));
const available = existsSync(python) && process.platform !== 'win32';
const roots: string[] = [];

async function fixture(): Promise<ExecutionContext> {
  const directory = await mkdtemp(join(tmpdir(), 'office-test-'));
  roots.push(directory);
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  return {
    workspaceRoot: await realpath(workspaceRoot),
    profileDirectory,
    readOnly: false,
    shellAccess: 'full-access',
    signal: new AbortController().signal,
  };
}

function json(result: ExecutionResult): Record<string, unknown> {
  const first = result.content[0];
  if (first?.type !== 'text') throw new Error('Expected report text');
  const value: unknown = JSON.parse(first.text);
  if (typeof value !== 'object' || value === null) throw new Error('Expected report object');
  return Object.fromEntries(Object.entries(value));
}

async function hash(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function pythonFixture(code: string, directory: string): Promise<void> {
  await new Promise<void>((accept, reject) => {
    execFile(
      python,
      ['-B', '-c', code],
      { cwd: directory, timeout: 10_000, maxBuffer: 100_000 },
      (error) => {
        if (error) reject(new Error('Office fixture process failed', { cause: error }));
        else accept();
      },
    );
  });
}

afterEach(async () => {
  for (const directory of roots.splice(0)) await rm(directory, { recursive: true, force: true });
});

it('rejects malformed arguments and read-only mutations before starting Python', async () => {
  const context = await fixture();
  await expect(
    executeOfficeTool('office_docx', { output: 'a.docx', arbitraryCode: 'no' }, context),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  await expect(
    executeOfficeTool('office_docx', { output: 'a.docx' }, { ...context, readOnly: true }),
  ).rejects.toMatchObject({ code: 'READ_ONLY' });
});

it('reports an unavailable configured interpreter without downloading dependencies or publishing files', async () => {
  const context = await fixture();
  await expect(
    executeOfficeTool('office_docx', { output: 'a.docx' }, context, {
      pythonPath: '/definitely-missing-office-python',
    }),
  ).rejects.toMatchObject({
    code:
      process.platform === 'win32' ? 'OFFICE_PLATFORM_UNAVAILABLE' : 'OFFICE_DEPENDENCY_MISSING',
  });
  expect(existsSync(join(context.workspaceRoot, 'a.docx'))).toBe(false);
});

describe.skipIf(!available)('real installed Python office workflows', () => {
  it('keeps large inspection results valid JSON below the public tool limit without losing artifact checks', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    const result = await executeOfficeTool(
      'office_docx',
      {
        output: 'large.docx',
        paragraphs: Array.from({ length: 6 }, () => ({ text: '"'.repeat(15_000) })),
      },
      context,
      options,
    );
    const content = result.content[0];
    if (content?.type !== 'text') throw new Error('Expected Office report text');
    expect(content.text.length).toBeLessThan(128_000);
    expect(json(result)).toMatchObject({
      artifact: { path: 'large.docx', format: 'docx' },
      report: { truncated: true },
    });
    expect(content.text).toContain('"notVerified":[');
    expect(content.text).toContain('"validation":[');
    const inspected = await executeOfficeTool(
      'office_inspect',
      { source: 'large.docx' },
      context,
      options,
    );
    expect(json(inspected)).toMatchObject({ truncated: true, format: 'docx' });
  });

  it('creates and edits DOCX annotations, notes, fields and metadata while preserving the source', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    await executeOfficeTool(
      'office_docx',
      {
        output: 'source.docx',
        paragraphs: [{ text: 'Office report', heading: 1 }, { text: 'Original paragraph' }],
        tables: [
          {
            rows: [
              ['Key', 'Value'],
              ['A', '1'],
            ],
          },
        ],
      },
      context,
      options,
    );
    const original = await hash(join(context.workspaceRoot, 'source.docx'));
    await executeOfficeTool(
      'office_docx',
      {
        source: 'source.docx',
        output: 'edited.docx',
        operations: [
          { kind: 'replace_text', old: 'Original', replacement: 'Reviewed' },
          { kind: 'comment_add', paragraph: 1, text: 'Review note', author: 'Harness' },
          { kind: 'note', paragraph: 1, text: 'Footnote', noteType: 'footnote' },
          { kind: 'note', paragraph: 1, text: 'Endnote', noteType: 'endnote' },
          { kind: 'bookmark', paragraph: 1, name: 'ReportAnchor' },
          { kind: 'field', fieldType: 'ref', target: 'ReportAnchor' },
          { kind: 'field', fieldType: 'toc' },
          { kind: 'field', fieldType: 'caption', target: 'Figure', text: 'Figure 1' },
          { kind: 'content_control', tag: 'status', text: 'Reviewed' },
          { kind: 'metadata', title: 'Reviewed report', creator: 'Harness' },
        ],
      },
      context,
      options,
    );
    const inspected = json(
      await executeOfficeTool('office_inspect', { source: 'edited.docx' }, context, options),
    );
    expect(inspected).toMatchObject({
      comments: 1,
      footnotes: true,
      endnotes: true,
      contentControls: 1,
      bookmarks: ['ReportAnchor'],
    });
    expect(String(inspected['text'])).toContain('Reviewed paragraph');
    expect(await hash(join(context.workspaceRoot, 'source.docx'))).toBe(original);
    await executeOfficeTool(
      'office_docx',
      {
        source: 'edited.docx',
        output: 'no-comment.docx',
        operations: [{ kind: 'comment_remove', id: 0 }],
      },
      context,
      options,
    );
    expect(
      json(
        await executeOfficeTool('office_inspect', { source: 'no-comment.docx' }, context, options),
      )['comments'],
    ).toBe(0);
  });

  it('accepts/rejects plain DOCX revisions and rejects structural revisions', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    await executeOfficeTool(
      'office_docx',
      { output: 'source.docx', paragraphs: [{ text: 'Base' }] },
      context,
      options,
    );
    await pythonFixture(
      "import zipfile,xml.etree.ElementTree as E; p='source.docx'; z=zipfile.ZipFile(p); d={n:z.read(n) for n in z.namelist()}; z.close(); w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'; r=E.fromstring(d['word/document.xml']); q=next(r.iter(w+'p')); i=E.SubElement(q,w+'ins',{w+'id':'1',w+'author':'Test'}); E.SubElement(E.SubElement(i,w+'r'),w+'t').text='Added'; j=E.SubElement(q,w+'del',{w+'id':'2',w+'author':'Test'}); E.SubElement(E.SubElement(j,w+'r'),w+'delText').text='Removed'; d['word/document.xml']=E.tostring(r); z=zipfile.ZipFile('revisions.docx','w'); [z.writestr(n,b) for n,b in d.items()]; z.close()",
      context.workspaceRoot,
    );
    await executeOfficeTool(
      'office_docx',
      {
        source: 'revisions.docx',
        output: 'accepted.docx',
        operations: [{ kind: 'revisions', action: 'accept' }],
      },
      context,
      options,
    );
    await executeOfficeTool(
      'office_docx',
      {
        source: 'revisions.docx',
        output: 'rejected.docx',
        operations: [{ kind: 'revisions', action: 'reject' }],
      },
      context,
      options,
    );
    expect(
      String(
        json(
          await executeOfficeTool('office_inspect', { source: 'accepted.docx' }, context, options),
        )['text'],
      ),
    ).toContain('BaseAdded');
    expect(
      String(
        json(
          await executeOfficeTool('office_inspect', { source: 'rejected.docx' }, context, options),
        )['text'],
      ),
    ).toContain('BaseRemoved');
    await executeOfficeTool(
      'office_docx',
      { source: 'source.docx', output: 'merged.docx', mergeSources: ['accepted.docx'] },
      context,
      options,
    );
    expect(
      String(
        json(
          await executeOfficeTool('office_inspect', { source: 'merged.docx' }, context, options),
        )['text'],
      ),
    ).toContain('BaseAdded');
    await expect(
      executeOfficeTool(
        'office_docx',
        { source: 'source.docx', output: 'bad-merge.docx', mergeSources: ['revisions.docx'] },
        context,
        options,
      ),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
  });

  it('creates, reorders, appends, rotates and visually renders real PDF pages', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    await executeOfficeTool(
      'office_pdf',
      {
        output: 'source.pdf',
        pages: [
          {
            text: 'First page',
            tables: [
              {
                rows: [
                  ['Name', 'Value'],
                  ['A', 1],
                ],
              },
            ],
          },
          { text: 'Second page' },
        ],
      },
      context,
      options,
    );
    const original = await hash(join(context.workspaceRoot, 'source.pdf'));
    await executeOfficeTool(
      'office_pdf',
      {
        source: 'source.pdf',
        output: 'edited.pdf',
        selectPages: [2, 1],
        appendSources: ['source.pdf'],
        rotations: [{ page: 1, degrees: 90 }],
        overlays: [
          { page: 2, x: 36, y: 100, width: 200, height: 40, text: 'Overlay', cover: true },
        ],
      },
      context,
      options,
    );
    expect(
      json(await executeOfficeTool('office_inspect', { source: 'edited.pdf' }, context, options))[
        'pages'
      ],
    ).toBe(4);
    const pages = await executeOfficeTool(
      'pdf_read_pages',
      { source: 'edited.pdf', pages: [1, 2], maxPixels: 600 },
      context,
      options,
    );
    const images = pages.content.filter((item) => item.type === 'image');
    expect(images).toHaveLength(2);
    for (const image of images)
      expect(Buffer.from(image.data, 'base64').subarray(0, 8).toString('hex')).toBe(
        '89504e470d0a1a0a',
      );
    expect(await hash(join(context.workspaceRoot, 'source.pdf'))).toBe(original);
  });

  it('fills actual PDF fields, validates values and bounds flattening to text fields', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    await pythonFixture(
      "from reportlab.pdfgen import canvas; c=canvas.Canvas('form.pdf'); c.drawString(30,790,'Form'); c.acroForm.textfield(name='name',x=40,y=700,width=180,height=30); c.showPage(); c.save()",
      context.workspaceRoot,
    );
    await executeOfficeTool(
      'office_pdf',
      { source: 'form.pdf', output: 'filled.pdf', fields: { name: 'Harness' } },
      context,
      options,
    );
    expect(
      json(await executeOfficeTool('office_inspect', { source: 'filled.pdf' }, context, options))[
        'fields'
      ],
    ).toMatchObject([{ name: 'name', value: 'Harness' }]);
    await executeOfficeTool(
      'office_pdf',
      { source: 'form.pdf', output: 'flat.pdf', fields: { name: 'Harness' }, flatten: true },
      context,
      options,
    );
    expect(
      json(await executeOfficeTool('office_inspect', { source: 'flat.pdf' }, context, options))[
        'fields'
      ],
    ).toEqual([]);
    await expect(
      executeOfficeTool(
        'office_pdf',
        { source: 'form.pdf', output: 'bad.pdf', fields: { missing: 'x' } },
        context,
        options,
      ),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
    const rendered = await executeOfficeTool(
      'pdf_read_pages',
      { source: 'flat.pdf', pages: [1], maxPixels: 500 },
      context,
      options,
    );
    expect(rendered.content.some((item) => item.type === 'image')).toBe(true);
  });

  it('creates and edits spreadsheet data, formulas, styles, tables and native charts without inventing formula caches', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    await executeOfficeTool(
      'office_xlsx',
      {
        output: 'source.xlsx',
        sheets: [
          {
            name: 'Data',
            rows: [
              ['Name', 'Amount'],
              ['A', 10],
              ['B', 20],
            ],
            cells: [
              {
                cell: 'B4',
                value: '=SUM(B2:B3)',
                bold: true,
                numberFormat: '0.00',
                fill: 'EEEEEE',
              },
            ],
            tables: [{ name: 'Sales', range: 'A1:B3' }],
            charts: [
              {
                anchor: 'D2',
                chart: {
                  kind: 'bar',
                  categories: ['A', 'B'],
                  series: [{ name: 'Sales', values: [10, 20] }],
                },
              },
            ],
          },
        ],
      },
      context,
      options,
    );
    const before = await hash(join(context.workspaceRoot, 'source.xlsx'));
    const inspected = json(
      await executeOfficeTool('office_inspect', { source: 'source.xlsx' }, context, options),
    );
    expect(inspected['charts']).toBe(1);
    expect(inspected['formulas']).toMatchObject([{ formula: '=SUM(B2:B3)' }]);
    expect(inspected['formulaCaches']).toMatchObject([{ cachedValue: null }]);
    await executeOfficeTool(
      'office_xlsx',
      {
        source: 'source.xlsx',
        output: 'edited.xlsx',
        sheets: [{ name: 'Data', cells: [{ cell: 'B2', value: 15 }] }],
      },
      context,
      options,
    );
    expect(await hash(join(context.workspaceRoot, 'source.xlsx'))).toBe(before);
    expect(String(inspected['notVerified'])).toContain('cannot be verified');
    await expect(
      executeOfficeTool(
        'office_xlsx',
        {
          output: 'unsafe.xlsx',
          sheets: [{ name: 'Data', rows: [['=WEBSERVICE("https://example.com")']] }],
        },
        context,
        options,
      ),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
  });

  it('creates and edits native PPTX text/table/chart objects while keeping template dimensions and parts', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    const chart = {
      kind: 'bar',
      categories: ['A', 'B'],
      series: [{ name: 'Sales', values: [1, 2] }],
    };
    await executeOfficeTool(
      'office_pptx',
      {
        output: 'source.pptx',
        width: 12,
        height: 7,
        slides: [
          {
            shapes: [
              { kind: 'text', x: 0.5, y: 0.5, width: 5, height: 0.6, text: 'Native title' },
              {
                kind: 'table',
                x: 0.5,
                y: 2,
                width: 4,
                height: 2,
                rows: [
                  ['A', 'B'],
                  ['1', '2'],
                ],
              },
              { kind: 'chart', x: 5, y: 2, width: 5, height: 4, chart },
            ],
          },
        ],
      },
      context,
      options,
    );
    const original = await hash(join(context.workspaceRoot, 'source.pptx'));
    const before = json(
      await executeOfficeTool('office_inspect', { source: 'source.pptx' }, context, options),
    );
    await executeOfficeTool(
      'office_pptx',
      {
        source: 'source.pptx',
        output: 'edited.pptx',
        edits: [
          { slide: 0, shape: 0, kind: 'text', text: 'Edited title' },
          { slide: 0, shape: 1, kind: 'table_cell', row: 1, column: 1, text: '3' },
          {
            slide: 0,
            shape: 2,
            kind: 'chart',
            chart: { ...chart, series: [{ name: 'Sales', values: [3, 4] }] },
          },
        ],
      },
      context,
      options,
    );
    const after = json(
      await executeOfficeTool('office_inspect', { source: 'edited.pptx' }, context, options),
    );
    expect(after['widthEmu']).toBe(before['widthEmu']);
    expect(after['heightEmu']).toBe(before['heightEmu']);
    expect(JSON.stringify(after)).toContain('Edited title');
    expect(await hash(join(context.workspaceRoot, 'source.pptx'))).toBe(original);
    await expect(
      executeOfficeTool(
        'office_pptx',
        {
          output: 'overflow.pptx',
          slides: [
            { shapes: [{ kind: 'text', x: 29, y: 0, width: 2, height: 1, text: 'Outside' }] },
          ],
        },
        context,
        options,
      ),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
  });

  it('refuses traversal, soft links, existing outputs and damaged packages', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    await writeFile(join(context.workspaceRoot, 'existing.docx'), 'preserve');
    await expect(
      executeOfficeTool('office_docx', { output: 'existing.docx' }, context, options),
    ).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    await expect(
      executeOfficeTool('office_docx', { output: '../escape.docx' }, context, options),
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(
      executeOfficeTool('office_inspect', { source: 'existing.docx' }, context, options),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
    await symlink(
      resolve(context.workspaceRoot, 'existing.docx'),
      join(context.workspaceRoot, 'link.docx'),
    );
    await expect(
      executeOfficeTool('office_inspect', { source: 'link.docx' }, context, options),
    ).rejects.toMatchObject({ code: 'SYMLINK_PATH' });
    expect(await readFile(join(context.workspaceRoot, 'existing.docx'), 'utf8')).toBe('preserve');
  });

  it('repairs only a missing simple form field tree and rejects encrypted PDFs', async () => {
    const context = await fixture();
    const options = { pythonPath: python };
    await pythonFixture(
      "from reportlab.pdfgen import canvas; from pypdf import PdfReader,PdfWriter; c=canvas.Canvas('form.pdf'); c.acroForm.textfield(name='name',x=40,y=700,width=180,height=30); c.showPage(); c.save(); w=PdfWriter(clone_from='form.pdf'); w.root_object['/AcroForm'].get_object().pop('/Fields'); w.write('orphan.pdf'); w=PdfWriter(clone_from='form.pdf'); w.encrypt('not-a-real-secret'); w.write('encrypted.pdf')",
      context.workspaceRoot,
    );
    await executeOfficeTool(
      'office_pdf',
      {
        source: 'orphan.pdf',
        output: 'repaired.pdf',
        repairFields: true,
        fields: { name: 'Repaired' },
      },
      context,
      options,
    );
    expect(
      json(await executeOfficeTool('office_inspect', { source: 'repaired.pdf' }, context, options))[
        'fields'
      ],
    ).toMatchObject([{ name: 'name', value: 'Repaired' }]);
    await expect(
      executeOfficeTool('office_inspect', { source: 'encrypted.pdf' }, context, options),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
  });

  it('cancels an in-flight owned worker and waits until its child process group exits', async () => {
    if (process.platform === 'win32') return;
    const context = await fixture();
    const temporary = await mkdtemp(join(tmpdir(), 'office-process-test-'));
    roots.push(temporary);
    const ready = join(temporary, 'ready.json');
    const resources = join(temporary, 'resources');
    await mkdir(resources);
    const worker = await readFile(
      fileURLToPath(new URL('./support/slow-worker.py', import.meta.url)),
    );
    await writeFile(join(resources, 'runner.py'), worker);
    const controller = new AbortController();
    const operation = runOfficeProcess(
      { ready },
      temporary,
      context.workspaceRoot,
      resources,
      { ...context, signal: controller.signal },
      { pythonPath: python },
    );
    const rejection = expect(operation).rejects.toMatchObject({ code: 'CANCELLED' });
    const deadline = performance.now() + 5000;
    while (!existsSync(ready)) {
      if (performance.now() >= deadline) throw new Error('Owned worker did not become ready');
      await delay(10);
    }
    const pids: unknown = JSON.parse(await readFile(ready, 'utf8'));
    if (
      typeof pids !== 'object' ||
      pids === null ||
      !('parent' in pids) ||
      !('child' in pids) ||
      typeof pids.parent !== 'number' ||
      typeof pids.child !== 'number'
    )
      throw new Error('Invalid fixture PID record');
    const parentPid = pids.parent;
    const childPid = pids.child;
    controller.abort();
    await rejection;
    expect(() => process.kill(parentPid, 0)).toThrow();
    expect(() => process.kill(childPid, 0)).toThrow();
  });

  it('uses macOS isolation for ask/auto rather than silently running on the host', async ({
    skip,
  }) => {
    if (process.platform !== 'darwin') skip();
    const context = await fixture();
    const result = await executeOfficeTool(
      'office_pdf',
      { output: 'isolated.pdf', pages: [{ text: 'Sandboxed PDF' }] },
      { ...context, shellAccess: 'sandboxed' },
      { pythonPath: python },
    );
    expect(json(result)['artifact']).toMatchObject({ path: 'isolated.pdf', format: 'pdf' });
  });
});
