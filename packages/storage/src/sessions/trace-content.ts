import type { ModelRequestDetailQuery, RequestContentItem } from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors';

export interface TraceContentSource {
  role: string;
  text: string;
  images: number;
}
export interface TraceContentPage {
  items: RequestContentItem[];
  nextCursor: number | null;
  nextOffset: number | null;
}

const MAXIMUM_PAGE_BYTES = 60 * 1024;
const secretName =
  /^(authorization|proxy-authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret)$/i;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 64) return '[depth limit]';
  if (Array.isArray(value)) return value.map((item) => safeValue(item, depth + 1));
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      secretName.test(key) ? '[redacted]' : safeValue(entry, depth + 1),
    ]),
  );
}

/** Project model-visible content without response signatures, binary data or host codecs. */
export function requestContent(value: unknown): TraceContentSource {
  if (typeof value === 'string') return { role: 'text', text: value, images: 0 };
  if (!object(value)) return { role: 'json', text: JSON.stringify(value) ?? '', images: 0 };
  const message = object(value['message']) ? value['message'] : value;
  const role = typeof message['role'] === 'string' ? message['role'] : 'tool';
  const content = message['content'];
  if (typeof content === 'string') return { role, text: content, images: 0 };
  if (!Array.isArray(content))
    return { role, text: JSON.stringify(safeValue(message), null, 2), images: 0 };
  let images = 0;
  const pieces: string[] = [];
  for (const part of content) {
    if (!object(part)) continue;
    if (part['type'] === 'image') {
      images += 1;
      pieces.push('[image]');
    } else if (part['type'] === 'text' && typeof part['text'] === 'string')
      pieces.push(part['text']);
    else if (part['type'] === 'thinking' && typeof part['thinking'] === 'string')
      pieces.push(part['thinking']);
    else if (part['type'] === 'toolCall')
      pieces.push(
        JSON.stringify(
          safeValue({
            type: 'toolCall',
            id: part['id'],
            name: part['name'],
            arguments: part['arguments'],
          }),
          null,
          2,
        ),
      );
  }
  return { role, text: pieces.join('\n'), images };
}

/** Page serialized text, resuming a partial item with an explicit character offset. */
export function contentPage(
  total: number,
  read: (index: number) => TraceContentSource,
  query: ModelRequestDetailQuery,
): TraceContentPage {
  const cursor = query.cursor ?? 0;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 20;
  if (cursor > total || (cursor === total && offset !== 0))
    throw new StorageError(
      'TRACE_QUERY_INVALID',
      'Trace content cursor is outside the requested section',
    );
  const items: RequestContentItem[] = [];
  let bytes = 0;
  for (let position = cursor; position < total && items.length < limit; position += 1) {
    const source = read(position);
    const start = position === cursor ? offset : 0;
    if (start > source.text.length)
      throw new StorageError(
        'TRACE_QUERY_INVALID',
        'Trace content offset is outside the requested item',
      );
    const available = MAXIMUM_PAGE_BYTES - bytes;
    const make = (end: number): RequestContentItem => ({
      index: position,
      offset: start,
      role: source.role.slice(0, 100),
      text: source.text.slice(start, end),
      images: source.images,
      truncated: end < source.text.length,
    });
    let low = start;
    let high = Math.min(source.text.length, start + 65536);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(JSON.stringify(make(middle))) <= available) low = middle;
      else high = middle - 1;
    }
    if (
      low < source.text.length &&
      low > start &&
      /[\uD800-\uDBFF]/.test(source.text[low - 1] ?? '')
    )
      low -= 1;
    if (low === start && start !== source.text.length)
      return { items, nextCursor: position, nextOffset: start };
    const item = make(low);
    items.push(item);
    bytes += Buffer.byteLength(JSON.stringify(item));
    if (item.truncated) return { items, nextCursor: position, nextOffset: low };
    if (items.length === limit && position + 1 < total)
      return { items, nextCursor: position + 1, nextOffset: 0 };
  }
  return { items, nextCursor: null, nextOffset: null };
}
