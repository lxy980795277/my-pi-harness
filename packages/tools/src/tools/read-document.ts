import { extname } from 'node:path';
import { Type } from 'typebox';
import { DocumentError, extractDocument, extractPdf } from '../utils/document-text.js';
import { readDocumentInput } from '../lib/document-input.js';
import { completeToolRegistration } from '../lib/tool-registry.js';

const parameters = Type.Object(
  { path: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
);

/** Extract bounded document body text in an owned parser worker; no rendering or OCR. */
export const readDocumentTool = completeToolRegistration({
  name: 'read_document',
  description:
    'Extract bounded text from PDF, Office, OpenDocument or EPUB documents; no OCR or layout verification.',
  parameters,
  scope: 'workspace',
  loading: 'on-demand',
  readOnly: true,
  async execute(ports, args, invocation) {
    const context = await ports.workspace(invocation.signal);
    const bytes = await readDocumentInput(args.path, context, 33_554_432);
    let text: string;
    if (bytes.subarray(0, 5).toString() === '%PDF-') text = await extractPdf(bytes, context.signal);
    else {
      const format = extname(args.path).slice(1).toLowerCase();
      if (
        !['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'odt', 'ods', 'odp', 'epub'].includes(
          format,
        )
      )
        throw new DocumentError(
          'DOCUMENT_FAILED',
          'Use a PDF, Office, OpenDocument or EPUB document',
        );
      if (bytes[0] !== 80 || bytes[1] !== 75)
        throw new DocumentError('DOCUMENT_FAILED', 'Document ZIP structure is missing');
      text = await extractDocument(bytes, format, context.signal);
    }
    return { summary: `Read document ${args.path}`, content: [{ type: 'text', text }] };
  },
});
