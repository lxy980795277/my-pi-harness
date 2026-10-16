import { Worker } from 'node:worker_threads';
import { checkCancelled, ExecutionError } from './errors.js';

const workerSource = `
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

/** Extract selected document bytes in an owned, bounded worker; cancellation waits for exit. */
export async function extractDocument(
  bytes: Uint8Array,
  format: string,
  signal: AbortSignal,
): Promise<string> {
  checkCancelled(signal);
  const worker = new Worker(workerSource, {
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
      abort = () => reject(new ExecutionError('CANCELLED', 'Document extraction was cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(() => {
        reject(new ExecutionError('TIMEOUT', 'Document extraction exceeded its time limit'));
      }, 15_000);
      worker.on('error', (cause) => {
        reject(new ExecutionError('DOCUMENT_FAILED', 'Document extraction failed', { cause }));
      });
      worker.on('exit', () => {
        reject(new ExecutionError('DOCUMENT_FAILED', 'Document extraction worker stopped'));
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
          new ExecutionError('DOCUMENT_FAILED', 'Document is damaged, encrypted or unsupported'),
        );
      });
    });
  } finally {
    signal.removeEventListener('abort', abort);
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}
