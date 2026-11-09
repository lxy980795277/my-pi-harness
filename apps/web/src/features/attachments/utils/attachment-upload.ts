import {
  ATTACHMENT_BYTE_LIMITS,
  ATTACHMENT_FORMATS,
  type AttachmentUpload,
} from '@my-pi-harness/protocol';

/** File picker declarations follow the same supported formats as upload preflight and host parsing. */
export const ATTACHMENT_ACCEPT = [
  'text/*',
  ...ATTACHMENT_FORMATS.flatMap((format) => {
    return [
      format.mediaType,
      ...format.extensions.map((extension) => {
        return `.${extension}`;
      }),
    ];
  }),
].join(',');

/** Encodes one file locally; its bytes are retained only until the upload completes. */
export const fileToUpload = async (file: File, signal: AbortSignal): Promise<AttachmentUpload> => {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const format = ATTACHMENT_FORMATS.find((entry) => {
    return entry.extensions.includes(extension);
  });
  const mediaType = file.type || format?.mediaType || 'application/octet-stream';
  let limit: number = ATTACHMENT_BYTE_LIMITS.text;
  if (mediaType.startsWith('image/')) {
    limit = ATTACHMENT_BYTE_LIMITS.image;
  }
  if (format?.kind === 'document') {
    limit = ATTACHMENT_BYTE_LIMITS.document;
  }
  if (format?.kind === 'pdf' || mediaType === 'application/pdf') {
    limit = ATTACHMENT_BYTE_LIMITS.pdf;
  }
  if (file.size > limit) {
    throw new Error(`“${file.name}”超过大小限制。文本限 256 KB，图片限 2 MB，文档限 8 MB。`);
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
