import {
  MemoryPromptRangeSchema,
  MemoryRequestSnapshotSchema,
  type MemoryPromptRange,
  type MemoryRequestSnapshot,
} from '@my-pi-harness/protocol/internal';
import { Value } from 'typebox/value';
import { MemoryError } from './errors';

/** Historical decoding has a fixed allocation bound, independent of the current recall budget. */
const MAX_MEMORY_BLOCK_CHARACTERS = 2_000_000;

/** Encode the exact adopted snapshot once; the caller records its final UTF-16 prompt range. */
export function encodeMemoryBlock(snapshot: MemoryRequestSnapshot): string {
  if (!Value.Check(MemoryRequestSnapshotSchema, snapshot)) invalid();
  const text = JSON.stringify({ fingerprint: snapshot.fingerprint, entries: snapshot.entries });
  if (text.length > MAX_MEMORY_BLOCK_CHARACTERS) invalid();
  return text;
}

/** Decode only the recorded block, refusing truncation, split codepoints and invalid durable data. */
export function decodeMemoryBlock(
  systemPrompt: string,
  range: MemoryPromptRange,
): MemoryRequestSnapshot {
  if (
    !Value.Check(MemoryPromptRangeSchema, range) ||
    range.start >= range.end ||
    range.end > systemPrompt.length ||
    range.end - range.start > MAX_MEMORY_BLOCK_CHARACTERS ||
    splitsSurrogate(systemPrompt, range.start) ||
    splitsSurrogate(systemPrompt, range.end)
  )
    invalid();
  let value: unknown;
  try {
    value = JSON.parse(systemPrompt.slice(range.start, range.end));
  } catch {
    throw new MemoryError('MEMORY_SNAPSHOT_INVALID', 'The recorded memory block is invalid');
  }
  if (!Value.Check(MemoryRequestSnapshotSchema, value)) invalid();
  const identities = new Set<string>();
  for (const entry of value.entries) {
    if (identities.has(entry.id) || !entry.body.trim()) invalid();
    identities.add(entry.id);
  }
  return value;
}

function splitsSurrogate(text: string, offset: number): boolean {
  const left = text.charCodeAt(offset - 1);
  const right = text.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

function invalid(): never {
  throw new MemoryError('MEMORY_SNAPSHOT_INVALID', 'The recorded memory block is invalid');
}
