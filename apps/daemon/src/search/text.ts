import { createHash } from 'node:crypto';

/** Exact source ranges use UTF-16 offsets, including when the tokenizer asks for further splitting. */
export interface TextChunk {
  ordinal: number;
  start: number;
  end: number;
  text: string;
}

export interface ChunkTokens {
  (texts: string[], signal: AbortSignal): Promise<number[]>;
}

const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'word' });
const CJK = /\p{Script=Han}/u;
const WORD = /[\p{L}\p{N}]/u;
export const CHUNK_SIGNATURE = 'utf16-paragraph-480-e5-512-v1';

/** Encode terms as FTS-safe ASCII words; document and query normalization have the same owner. */
function term(text: string): string {
  const encoded = `w${Array.from(text)
    .map((character) => character.codePointAt(0)?.toString(16))
    .join('z')}`;
  if (encoded.length <= 180) return encoded;
  return `h${createHash('sha256').update(text).digest('hex')}`;
}

/** Index natural words plus exact CJK single/bigrams without treating all long-query characters as OR terms. */
export function documentTerms(text: string): string {
  const normalized = text.normalize('NFKC').toLowerCase();
  const terms: string[] = [];
  for (const entry of SEGMENTER.segment(normalized)) {
    if (entry.isWordLike && WORD.test(entry.segment)) terms.push(term(entry.segment));
  }
  const points = Array.from(normalized);
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    if (first === undefined || !CJK.test(first)) continue;
    terms.push(term(first));
    const second = points[index + 1];
    if (second !== undefined && CJK.test(second)) terms.push(term(first + second));
  }
  return terms.join(' ');
}

/** Return at most 65 terms so the query owner can expose its 64-term lexical limit. */
export function queryTerms(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase().trim();
  if (!normalized) return [];
  const points = Array.from(normalized);
  if (points.length <= 2 && points.every((point) => CJK.test(point))) return [term(normalized)];
  const terms = new Set<string>();
  for (const entry of SEGMENTER.segment(normalized)) {
    if (entry.isWordLike && WORD.test(entry.segment)) terms.add(term(entry.segment));
    if (terms.size === 65) break;
  }
  return [...terms];
}

function safeBoundary(text: string, start: number, end: number): number {
  if (end >= text.length) return text.length;
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    if (end - 1 === start) end += 1;
    else end -= 1;
  }
  return end;
}

/** Produce bounded, lossless source windows; every code unit belongs to exactly one chunk. */
export function textChunks(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = safeBoundary(text, start, start + 480);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline >= start + 240) end = newline + 1;
    }
    chunks.push({ ordinal: chunks.length, start, end, text: text.slice(start, end) });
    start = end;
  }
  return chunks;
}

/** Tokenizer counts include prefixes/special tokens; recursive splits preserve original source offsets. */
export async function tokenChunks(
  text: string,
  count: ChunkTokens,
  signal: AbortSignal,
): Promise<TextChunk[]> {
  let pending = textChunks(text);
  const complete: TextChunk[] = [];
  while (pending.length > 0) {
    signal.throwIfAborted();
    const batch = pending.splice(0, 16);
    const counts = await count(
      batch.map((chunk) => chunk.text),
      signal,
    );
    if (counts.length !== batch.length)
      throw new Error('Tokenizer returned an invalid count batch');
    const split: TextChunk[] = [];
    for (const [index, chunk] of batch.entries()) {
      const tokens = counts[index];
      if (tokens === undefined || !Number.isSafeInteger(tokens) || tokens < 1)
        throw new Error('Tokenizer returned an invalid token count');
      if (tokens <= 512) {
        complete.push(chunk);
        continue;
      }
      if (chunk.end - chunk.start <= 2)
        throw new Error('Source character exceeds local model token capacity');
      const middle = safeBoundary(text, chunk.start, Math.floor((chunk.start + chunk.end) / 2));
      split.push(
        { ordinal: 0, start: chunk.start, end: middle, text: text.slice(chunk.start, middle) },
        { ordinal: 0, start: middle, end: chunk.end, text: text.slice(middle, chunk.end) },
      );
    }
    pending = [...split, ...pending];
  }
  return complete
    .sort((left, right) => left.start - right.start)
    .map((chunk, ordinal) => ({ ...chunk, ordinal }));
}
