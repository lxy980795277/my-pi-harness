import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { executeOfficeTool } from '../../src/office/index.js';
import type { ExecutionContext, ExecutionResult } from '../../src/types.js';

const python =
  process.env['MY_PI_HARNESS_OFFICE_TEST_PYTHON'] ??
  fileURLToPath(new URL('../../../../.cache/office-venv/bin/python', import.meta.url));
const available = existsSync(python) && process.platform !== 'win32';
const directories: string[] = [];
const options = { pythonPath: python };

async function fixture(): Promise<ExecutionContext> {
  const directory = await mkdtemp(join(tmpdir(), 'office-format-test-'));
  directories.push(directory);
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

async function pythonCheck(context: ExecutionContext, code: string): Promise<void> {
  await new Promise<void>((accept, reject) => {
    execFile(
      python,
      ['-B', '-c', code],
      { cwd: context.workspaceRoot, timeout: 10_000, maxBuffer: 100_000 },
      (error, _output, diagnostics) => {
        if (error)
          reject(new Error(`Office file verification failed: ${diagnostics}`, { cause: error }));
        else accept();
      },
    );
  });
}

function report(result: ExecutionResult): Record<string, unknown> {
  const first = result.content[0];
  if (first?.type !== 'text') throw new Error('Missing Office report');
  const value: unknown = JSON.parse(first.text);
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Office report');
  return Object.fromEntries(Object.entries(value));
}

async function hash(context: ExecutionContext, name: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(join(context.workspaceRoot, name)))
    .digest('hex');
}

afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

it('rejects unknown typography fields and executable-looking image paths before worker execution', async () => {
  const context = await fixture();
  await expect(
    executeOfficeTool('office_docx', { output: 'bad.docx', layout: { arbitrary: 1 } }, context),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  await expect(
    executeOfficeTool(
      'office_docx',
      {
        output: 'bad.docx',
        images: [{ source: 'https://example.com/image.png', width: 100, altText: 'Image' }],
      },
      context,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  expect(existsSync(join(context.workspaceRoot, 'bad.docx'))).toBe(false);
});

describe.skipIf(!available)('formatted real Office documents', () => {
  it('writes native DOCX section sizes, styles, rich runs, repeated table headers, page fields and staged images', async () => {
    const context = await fixture();
    await pythonCheck(
      context,
      "from PIL import Image; Image.new('RGB',(200,100),'#2563eb').save('figure.png')",
    );
    await executeOfficeTool(
      'office_docx',
      {
        output: 'report.docx',
        layout: {
          width: 595,
          height: 842,
          margins: { top: 54, right: 48, bottom: 54, left: 48 },
          headerDistance: 24,
          footerDistance: 24,
        },
        defaultFont: { name: 'Arial', size: 11 },
        styles: [
          {
            name: 'Report Body',
            basedOn: 'Normal',
            font: { size: 12, color: '243247' },
            format: { lineSpacing: 1.5, spaceAfter: 9 },
          },
        ],
        header: { text: 'Engineering report', font: { size: 9 }, alignment: 'right' },
        footer: { text: 'Page ', alignment: 'center', pageNumber: true },
        paragraphs: [
          { text: 'Quarterly report', heading: 1, font: { size: 24 } },
          {
            runs: [
              { text: 'Result: ' },
              { text: 'Approved', font: { bold: true, color: '166534' } },
            ],
            style: 'Report Body',
            format: { keepTogether: true },
          },
        ],
        tables: [
          {
            rows: [
              ['Name', 'Value'],
              ['A', 42],
            ],
            style: 'Table Grid',
            headerRows: 1,
          },
        ],
        images: [
          { source: 'figure.png', width: 144, altText: 'Blue test figure', alignment: 'center' },
        ],
      },
      context,
      options,
    );
    const inspected = report(
      await executeOfficeTool('office_inspect', { source: 'report.docx' }, context, options),
    );
    expect(inspected).toMatchObject({
      imageCount: 1,
      sections: [{ size: { w: 595, h: 842 }, margins: { top: 54, left: 48, header: 24 } }],
    });
    await pythonCheck(
      context,
      `
from zipfile import ZipFile
from lxml import etree as E
w={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with ZipFile('report.docx') as z:
 d=E.fromstring(z.read('word/document.xml')); s=E.fromstring(z.read('word/styles.xml'))
 assert d.xpath('count(//w:tblHeader)',namespaces=w)==1
 assert d.xpath('//w:r[w:t="Approved"]/w:rPr/w:b/@w:val',namespaces=w)==['1']
 assert s.xpath('//w:style[w:name/@w:val="Report Body"]/w:rPr/w:sz/@w:val',namespaces=w)==['24']
 assert s.xpath('//w:style[@w:styleId="Normal"]/w:rPr/w:rFonts/@w:eastAsia',namespaces=w)==['Arial']
 footer=[n for n in z.namelist() if n.startswith('word/footer') and n.endswith('.xml')][0]
 assert E.fromstring(z.read(footer)).xpath('//w:fldSimple/@w:instr',namespaces=w)==[' PAGE ']
 assert b'Blue test figure' in z.read('word/document.xml')
`,
    );
  });

  it('formats a source paragraph and creates native tracked changes which can be accepted or rejected without changing the source', async () => {
    const context = await fixture();
    await executeOfficeTool(
      'office_docx',
      { output: 'source.docx', paragraphs: [{ text: 'Status: Pending', font: { bold: true } }] },
      context,
      options,
    );
    const original = await hash(context, 'source.docx');
    await executeOfficeTool(
      'office_docx',
      {
        source: 'source.docx',
        output: 'review.docx',
        layout: { margins: { top: 36, right: 36, bottom: 36, left: 36 } },
        operations: [
          {
            kind: 'format_paragraph',
            paragraph: 0,
            font: { size: 14 },
            format: { alignment: 'center', spaceAfter: 12 },
          },
          { kind: 'tracked_replace', old: 'Pending', replacement: 'Approved', author: 'Reviewer' },
        ],
      },
      context,
      options,
    );
    expect(
      report(
        await executeOfficeTool('office_inspect', { source: 'review.docx' }, context, options),
      )['revisions'],
    ).toBe(2);
    for (const action of ['accept', 'reject']) {
      await executeOfficeTool(
        'office_docx',
        {
          source: 'review.docx',
          output: `${action}.docx`,
          operations: [{ kind: 'revisions', action }],
        },
        context,
        options,
      );
      const actual = report(
        await executeOfficeTool('office_inspect', { source: `${action}.docx` }, context, options),
      );
      expect(actual['text']).toBe(`Status: ${action === 'accept' ? 'Approved' : 'Pending'}`);
      expect(actual['revisions']).toBe(0);
    }
    await pythonCheck(
      context,
      `
from zipfile import ZipFile
from lxml import etree as E
w={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with ZipFile('review.docx') as z:
 d=E.fromstring(z.read('word/document.xml'))
 assert d.xpath('//w:ins/w:r/w:rPr/w:b/@w:val',namespaces=w)==['1']
 assert d.xpath('//w:ins/w:r/w:rPr/w:sz/@w:val',namespaces=w)==['28']
 assert d.xpath('//w:pPr/w:jc/@w:val',namespaces=w)==['center']
`,
    );
    expect(await hash(context, 'source.docx')).toBe(original);
  });

  it('refuses unsupported layout combinations, unknown styles, invalid images and ambiguous tracked replacements', async () => {
    const context = await fixture();
    const invalid = [
      { output: 'both.docx', paragraphs: [{ text: 'A', runs: [{ text: 'B' }] }] },
      { output: 'style.docx', paragraphs: [{ text: 'A', style: 'Missing' }] },
      {
        output: 'cycle.docx',
        styles: [
          { name: 'Body', basedOn: 'Normal' },
          { name: 'Normal', basedOn: 'Body' },
        ],
        paragraphs: [{ text: 'A', style: 'Body' }],
      },
      {
        output: 'margin.docx',
        layout: { width: 144, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      },
    ];
    for (const args of invalid) {
      await expect(executeOfficeTool('office_docx', args, context, options)).rejects.toMatchObject({
        code: 'OFFICE_OPERATION_FAILED',
      });
      expect(existsSync(join(context.workspaceRoot, args.output))).toBe(false);
    }
    await writeFile(join(context.workspaceRoot, 'bad.png'), 'Not an image');
    await expect(
      executeOfficeTool(
        'office_docx',
        { output: 'image.docx', images: [{ source: 'bad.png', width: 100, altText: 'Invalid' }] },
        context,
        options,
      ),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
    await pythonCheck(
      context,
      "from PIL import Image; Image.new('RGB',(200,100),'#2563eb').save('valid.png')",
    );
    await expect(
      executeOfficeTool(
        'office_docx',
        {
          output: 'too-wide.docx',
          images: [{ source: 'valid.png', width: 450, altText: 'Too wide' }],
        },
        context,
        options,
      ),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
    expect(existsSync(join(context.workspaceRoot, 'too-wide.docx'))).toBe(false);
    await executeOfficeTool(
      'office_docx',
      {
        output: 'fits.docx',
        images: [{ source: 'valid.png', width: 432, altText: 'Exact usable width' }],
      },
      context,
      options,
    );
    expect(
      report(await executeOfficeTool('office_inspect', { source: 'fits.docx' }, context, options)),
    ).toMatchObject({ imageCount: 1, sections: [{ margins: { left: 90, right: 90 } }] });
    await executeOfficeTool(
      'office_docx',
      { output: 'split.docx', paragraphs: [{ runs: [{ text: 'Pend' }, { text: 'ing' }] }] },
      context,
      options,
    );
    await expect(
      executeOfficeTool(
        'office_docx',
        {
          source: 'split.docx',
          output: 'tracked.docx',
          operations: [
            {
              kind: 'tracked_replace',
              old: 'Pending',
              replacement: 'Approved',
              author: 'Reviewer',
            },
          ],
        },
        context,
        options,
      ),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
    expect(existsSync(join(context.workspaceRoot, 'tracked.docx'))).toBe(false);
  });

  it('automatically paginates literal prose and a wrapped table while repeating headers and rendering the first and last pages', async () => {
    const context = await fixture();
    const prose = Array.from({ length: 18 }, (_, index) => ({
      kind: 'paragraph',
      text:
        `Section ${index + 1}. ` +
        'A long report paragraph remains editable at the source and wraps within the page margins. '.repeat(
          10,
        ),
    }));
    await executeOfficeTool(
      'office_pdf',
      {
        output: 'flow.pdf',
        layout: {
          width: 420,
          height: 595,
          margins: { top: 40, right: 32, bottom: 40, left: 32 },
          font: 'Helvetica',
          fontSize: 10,
          lineSpacing: 1.4,
          header: 'Pagination audit',
          footer: 'Internal report',
          pageNumbers: true,
        },
        flow: [
          { kind: 'heading', text: 'Literal <b>content</b> & tables', level: 1 },
          ...prose,
          {
            kind: 'table',
            headerRows: 1,
            columnWidths: [80, 276],
            rows: [
              ['Row label', 'Description'],
              ...Array.from({ length: 85 }, (_, index) => [
                `ITEM-${index}`,
                `Description for row ${index}. ` +
                  'Wrapped text must stay inside its column. '.repeat(3),
              ]),
            ],
          },
          { kind: 'paragraph', text: 'FINAL-MARKER: all content arrived.' },
        ],
      },
      context,
      options,
    );
    const inspected = report(
      await executeOfficeTool('office_inspect', { source: 'flow.pdf' }, context, options),
    );
    const pages = inspected['pages'];
    if (typeof pages !== 'number') throw new Error('Missing PDF page count');
    expect(pages).toBeGreaterThan(6);
    expect(String(inspected['text'])).toContain('Literal <b>content</b> & tables');
    expect(String(inspected['text'])).toContain('ITEM-84');
    expect(String(inspected['text'])).toContain('FINAL-MARKER');
    await pythonCheck(
      context,
      `
from pypdf import PdfReader
r=PdfReader('flow.pdf'); pages=[p.extract_text() for p in r.pages]
assert all('Pagination audit' in text and 'Internal report' in text for text in pages)
table_pages=[text for text in pages if 'ITEM-' in text]
assert len(table_pages)>2 and all('Row label' in text for text in table_pages)
assert all(float(p.mediabox.width)==420 and float(p.mediabox.height)==595 for p in r.pages)
`,
    );
    const rendered = await executeOfficeTool(
      'pdf_read_pages',
      { source: 'flow.pdf', pages: [1, pages], maxPixels: 900 },
      context,
      options,
    );
    expect(rendered.content.filter((item) => item.type === 'image')).toHaveLength(2);
    await expect(
      executeOfficeTool(
        'office_pdf',
        {
          output: 'bad.pdf',
          flow: [{ kind: 'table', columnWidths: [400, 400], rows: [['A', 'B']] }],
          layout: { width: 420 },
        },
        context,
        options,
      ),
    ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
    expect(existsSync(join(context.workspaceRoot, 'bad.pdf'))).toBe(false);
  });

  it('fills choice exports and multi-select values, preserves option labels and rejects unsupported values', async () => {
    const context = await fixture();
    await pythonCheck(
      context,
      `
from reportlab.pdfgen import canvas
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, NameObject, TextStringObject
c=canvas.Canvas('base.pdf'); c.drawString(36,790,'Choice form')
c.acroForm.choice(name='color',options=['Red','Blue'],value='Red',fieldFlags='combo',x=40,y=700,width=180,height=25)
c.acroForm.listbox(name='tags',options=['A','B','C'],value=['A'],fieldFlags='multiSelect',x=40,y=550,width=180,height=100)
c.showPage(); c.save()
w=PdfWriter(clone_from='base.pdf'); f=w.get_fields()['color'].indirect_reference.get_object()
f[NameObject('/Opt')]=ArrayObject(ArrayObject([TextStringObject(v),TextStringObject(label)]) for v,label in [('red','Red'),('blue','Blue')]); f[NameObject('/V')]=TextStringObject('red'); w.write('choices.pdf')
`,
    );
    const original = await hash(context, 'choices.pdf');
    await executeOfficeTool(
      'office_pdf',
      { source: 'choices.pdf', output: 'filled.pdf', fields: { color: 'blue', tags: ['A', 'C'] } },
      context,
      options,
    );
    expect(
      report(await executeOfficeTool('office_inspect', { source: 'filled.pdf' }, context, options))[
        'fields'
      ],
    ).toMatchObject([
      {
        name: 'color',
        value: 'blue',
        options: [
          { export: 'red', label: 'Red' },
          { export: 'blue', label: 'Blue' },
        ],
      },
      { name: 'tags', value: ['A', 'C'] },
    ]);
    await pythonCheck(
      context,
      `
from pypdf import PdfReader
r=PdfReader('filled.pdf'); fields=r.get_fields()
assert fields['color']['/V']=='blue' and list(fields['tags']['/V'])==['A','C']
for ref in r.pages[0]['/Annots']:
 a=ref.get_object(); assert a['/AP']['/N'].get_object().get_data()
assert list(fields['tags'].indirect_reference.get_object()['/I'])==[0,2]
`,
    );
    for (const fields of [{ color: 'unknown' }, { color: ['blue'] }, { tags: ['A', 'A'] }])
      await expect(
        executeOfficeTool(
          'office_pdf',
          { source: 'choices.pdf', output: 'invalid.pdf', fields },
          context,
          options,
        ),
      ).rejects.toMatchObject({ code: 'OFFICE_OPERATION_FAILED' });
    const rendered = await executeOfficeTool(
      'pdf_read_pages',
      { source: 'filled.pdf', pages: [1] },
      context,
      options,
    );
    expect(rendered.content.some((item) => item.type === 'image')).toBe(true);
    expect(await hash(context, 'choices.pdf')).toBe(original);
  });
});
