import { createPatch } from 'diff';
import type {
  FileChangeDetail,
  FileChangeDetailQuery,
  FileChangeSummary,
} from '@my-pi-harness/protocol';
import type { ArtifactBlobs } from '../../artifacts/blobs';
import { StorageError } from '../../shared/errors';

/** Original UTF-8 images remain readable even when bounded diff computation refuses a large edit. */
export function fileChangeContent(
  blobs: ArtifactBlobs,
  summary: FileChangeSummary,
  query: FileChangeDetailQuery,
): FileChangeDetail {
  const side = query.side ?? 'diff';
  const decode = (image: FileChangeSummary['before']): string =>
    image.exists
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blobs.read(image))
      : '';
  const before = decode(summary.before);
  const after = decode(summary.after);
  const text =
    side === 'before'
      ? before
      : side === 'after'
        ? after
        : createPatch(summary.path, before, after, 'before', 'after', {
            context: 3,
            maxEditLength: 20000,
            timeout: 1000,
          });
  if (text === undefined)
    throw new StorageError(
      'FILE_CHANGE_QUERY_INVALID',
      'This diff exceeds the comparison limit; read the before and after images instead',
    );
  const offset = query.offset ?? 0;
  if (
    offset > text.length ||
    (offset > 0 && offset < text.length && /[\uDC00-\uDFFF]/.test(text[offset] ?? ''))
  )
    throw new StorageError('FILE_CHANGE_QUERY_INVALID', 'File content offset is invalid');
  const overhead = Buffer.byteLength(
    JSON.stringify({
      change: summary,
      side,
      text: '',
      offset,
      nextOffset: Number.MAX_SAFE_INTEGER,
    }),
    'utf8',
  );
  const maximum = Math.min(query.maxBytes ?? 32768, 65536 - overhead);
  if (maximum < 16)
    throw new StorageError(
      'FILE_CHANGE_QUERY_INVALID',
      'File history metadata exceeds the page byte limit',
    );
  let low = offset,
    high = Math.min(text.length, offset + maximum);
  while (low < high) {
    const end = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(text.slice(offset, end)), 'utf8') <= maximum) low = end;
    else high = end - 1;
  }
  if (low < text.length && /[\uDC00-\uDFFF]/.test(text[low] ?? '')) low -= 1;
  return {
    change: summary,
    side,
    text: text.slice(offset, low),
    offset,
    nextOffset: low < text.length ? low : null,
  };
}
