import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPdf } from '../src/documents/extract-pdf.js';

function samplePdf(script?: string): Buffer {
  const stream = 'BT /F1 12 Tf 20 100 Td (Hello workspace) Tj ET';
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${script === undefined ? '' : ' /OpenAction 6 0 R'} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  if (script !== undefined)
    objects.push(`<< /S /JavaScript /JS (${script.replace(/[\\()]/g, '\\$&')}) >>`);
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(document);
}

it('extracts actual PDF text in an owned worker', async () => {
  expect(await extractPdf(samplePdf(), new AbortController().signal)).toContain('Hello workspace');
});

it('rejects malformed PDF without leaking parser details', async () => {
  await expect(
    extractPdf(Buffer.from('%PDF-invalid'), new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PDF_FAILED' });
});

it('extracts text without executing an embedded JavaScript OpenAction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-action-test-'));
  const sentinel = join(directory, 'executed.txt');
  try {
    const script = `globalThis.process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed')`;
    expect(await extractPdf(samplePdf(script), new AbortController().signal)).toContain(
      'Hello workspace',
    );
    await expect(readFile(sentinel)).rejects.toHaveProperty('code', 'ENOENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('cancels and settles the PDF worker before returning', async () => {
  const controller = new AbortController();
  const task = extractPdf(samplePdf(), controller.signal);
  controller.abort();
  await expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
});
