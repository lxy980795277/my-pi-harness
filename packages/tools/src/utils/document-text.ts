import { Worker } from 'node:worker_threads';
import { checkCancelled } from '@my-pi-harness/sandbox';

const documentWorkerSource = `
const { parentPort, workerData } = require('node:worker_threads');
async function extract() {
  const { parseOffice, generate } = await import(workerData.moduleUrl);
  const document = await parseOffice(Buffer.from(workerData.data), {
    fileType: workerData.format, ocr: false, extractAttachments: false,
    includeRawContent: false, includeFormatting: false,
    decompressionLimits: { maxUncompressedBytes: 33554432, maxZipEntries: 2000,
      maxXmlElements: 100000, maxTableCells: 20000,
      maxRepeatedContent: 256000, maxRawContentLength: 256000 }
  });
  const { value: text } = await generate(document, 'text', { includeImages: 'none' });
  const truncated = text.length > 250000;
  parentPort.postMessage({ text: text.slice(0, 250000)
    + (truncated ? '\\n[Document extraction truncated]' : '') });
}
extract().catch(() => parentPort.postMessage({ error: 'Document extraction failed' }));
`;

const pdfWorkerSource = `
const { parentPort, workerData } = require('node:worker_threads');
async function extract() {
  const { getDocument } = await import(workerData.moduleUrl);
  const task = getDocument({ data: new Uint8Array(workerData.data), useWasm: false,
    useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, enableXfa: false,
    stopAtErrors: true, maxImageSize: 1000000, verbosity: 0 });
  try {
    const document = await task.promise;
    const pages = [];
    let size = 0;
    for (let index = 1; index <= Math.min(document.numPages, 20); index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items.filter(item => 'str' in item).map(item => item.str).join(' ');
      pages.push('Page ' + index + '\\n' + text.slice(0, 100000 - size));
      size += text.length;
      page.cleanup();
      if (size >= 100000) break;
    }
    parentPort.postMessage({ text: 'PDF pages: ' + document.numPages + '\\n' + pages.join('\\n\\n')
      + (document.numPages > pages.length || size >= 100000 ? '\\n[PDF extraction truncated]' : '')
      + (size === 0 ? '\\n[No extractable text; OCR is not available]' : '') });
  } finally { await task.destroy(); }
}
extract().catch(() => parentPort.postMessage({ error: 'PDF extraction failed; the document may be encrypted or unsupported' }));
`;

/** Expected document-reading failure with a safe public diagnostic. */
export class DocumentError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DocumentError';
  }
}

/** Extract selected document bytes in an owned, bounded worker; cancellation waits for exit. */
export async function extractDocument(
  bytes: Uint8Array,
  format: string,
  signal: AbortSignal,
): Promise<string> {
  checkCancelled(signal);
  const worker = new Worker(documentWorkerSource, {
    eval: true,
    workerData: { data: bytes, format, moduleUrl: import.meta.resolve('officeparser') },
    resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 16, stackSizeMb: 8 },
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  let abort = (): void => {};
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<string>((accept, reject) => {
      abort = () => reject(new DocumentError('CANCELLED', 'Document extraction was cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(() => {
        reject(new DocumentError('TIMEOUT', 'Document extraction exceeded its time limit'));
      }, 15_000);
      worker.on('error', (cause) => {
        reject(new DocumentError('DOCUMENT_FAILED', 'Document extraction failed', { cause }));
      });
      worker.on('exit', () => {
        reject(new DocumentError('DOCUMENT_FAILED', 'Document extraction worker stopped'));
      });
      worker.on('message', (message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          'text' in message &&
          typeof message.text === 'string' &&
          message.text.length <= 251_000
        ) {
          accept(message.text);
          return;
        }
        reject(
          new DocumentError('DOCUMENT_FAILED', 'Document is damaged, encrypted or unsupported'),
        );
      });
    });
  } finally {
    signal.removeEventListener('abort', abort);
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}

/** Parse untrusted PDF bytes in a resource-limited worker; cancel waits for worker exit. */
export async function extractPdf(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
  checkCancelled(signal);
  const worker = new Worker(pdfWorkerSource, {
    eval: true,
    workerData: { data: bytes, moduleUrl: import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs') },
    resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 8 },
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  let abort = (): void => {};
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<string>((accept, reject) => {
      abort = () => {
        reject(new DocumentError('CANCELLED', 'PDF reading was cancelled'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(() => {
        reject(new DocumentError('TIMEOUT', 'PDF extraction exceeded its time limit'));
      }, 10_000);
      worker.on('error', (cause) => {
        reject(new DocumentError('PDF_FAILED', 'PDF extraction failed', { cause }));
      });
      worker.on('exit', (code) => {
        if (code !== 0) reject(new DocumentError('PDF_FAILED', 'PDF extraction worker stopped'));
      });
      worker.on('message', (message: unknown) => {
        if (typeof message !== 'object' || message === null) {
          reject(new DocumentError('PDF_FAILED', 'Invalid PDF worker response'));
          return;
        }
        if ('text' in message && typeof message.text === 'string' && message.text.length <= 101_000)
          accept(message.text);
        else
          reject(
            new DocumentError(
              'PDF_FAILED',
              'PDF extraction failed; the document may be encrypted or unsupported',
            ),
          );
      });
    });
  } finally {
    signal.removeEventListener('abort', abort);
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}
