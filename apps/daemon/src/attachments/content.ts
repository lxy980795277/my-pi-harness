import { extname } from 'node:path';
import { RuntimeError } from '@my-pi-harness/agent-runtime';

import {
  ATTACHMENT_BYTE_LIMITS,
  ATTACHMENT_FORMATS,
  ATTACHMENT_MAX_BASE64_LENGTH,
  type AttachmentDocumentFormat,
} from '@my-pi-harness/protocol';

/** Reject permissive Buffer decoding, including ignored garbage and incomplete padding. */
export function decodeUpload(value: string): Buffer {
  if (
    value.length > ATTACHMENT_MAX_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new RuntimeError('ATTACHMENT_INVALID', '附件编码无效。');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value)
    throw new RuntimeError('ATTACHMENT_INVALID', '附件编码无效。');
  return bytes;
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes.byteLength > ATTACHMENT_BYTE_LIMITS.text)
    throw new RuntimeError('ATTACHMENT_TOO_LARGE', '文本附件不能超过256KB。');
  if (bytes.includes(0)) throw new RuntimeError('ATTACHMENT_TYPE', '只支持UTF-8文本。');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new RuntimeError('ATTACHMENT_TYPE', '只支持UTF-8文本。', { cause });
  }
}

export function imageMediaType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return undefined;
}

export function safeName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 240 || /[\\/\u0000-\u001f\u007f]/.test(name))
    throw new RuntimeError('ATTACHMENT_NAME', '附件名称无效。');
  return name;
}

export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RuntimeError('CANCELLED', '附件处理已取消。');
}

/** Filename and MIME select a supported parser; the parser validates the archive contents. */
export function documentFormat(
  name: string,
  mediaType: string,
): AttachmentDocumentFormat | undefined {
  const extension = extname(name).slice(1).toLowerCase();
  const entry = ATTACHMENT_FORMATS.find((format) => {
    return format.kind === 'document' && format.extensions.includes(extension);
  });
  if (!entry || entry.kind !== 'document') return undefined;
  if (
    mediaType.toLowerCase() !== entry.mediaType.toLowerCase() &&
    mediaType !== 'application/octet-stream' &&
    !entry.aliases?.includes(mediaType)
  )
    throw new RuntimeError('ATTACHMENT_TYPE', '文档类型与文件扩展名不符。');
  return entry.parser;
}
