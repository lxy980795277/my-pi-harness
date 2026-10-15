import type { AttachmentUpload } from '@my-pi-harness/protocol';

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  ts: 'text/plain',
  tsx: 'text/plain',
  js: 'text/plain',
  jsx: 'text/plain',
  py: 'text/plain',
  yml: 'text/plain',
  yaml: 'text/plain',
  css: 'text/plain',
  html: 'text/plain',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
/** Encodes one file locally; its bytes are retained only until the upload completes. */
export const fileToUpload = async (file: File, signal: AbortSignal): Promise<AttachmentUpload> => {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const mediaType = file.type || EXTENSION_TYPES[extension] || 'application/octet-stream';
  let limit = 256_000;
  if (mediaType.startsWith('image/')) {
    limit = 2_097_152;
  }
  if (mediaType === 'application/pdf') {
    limit = 8_388_608;
  }
  if (file.size > limit) {
    throw new Error(`“${file.name}”超过大小限制。文本限 256 KB，图片限 2 MB，PDF 限 8 MB。`);
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return { name: file.name, mediaType, data: btoa(chunks.join('')) };
};
