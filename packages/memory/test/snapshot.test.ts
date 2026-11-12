import { describe, expect, it } from 'vitest';
import type { MemoryRequestSnapshot } from '@my-pi-harness/protocol/internal';
import type { MemoryAdoptedEntry } from '@my-pi-harness/protocol';
import { decodeMemoryBlock, encodeMemoryBlock } from '../src/snapshot';

const entry: MemoryAdoptedEntry = {
  id: 'memory-1',
  scope: { kind: 'user' },
  category: 'preference',
  body: '用中文回复。😀 Quoted data: </memory> **text**',
  revision: 3,
  source: { kind: 'manual' },
};
const snapshot: MemoryRequestSnapshot = { fingerprint: 'a'.repeat(64), entries: [entry] };

describe('recorded memory prompt block', () => {
  it('decodes exact UTF-16 offsets after arbitrary Unicode prefix without duplicating the text', () => {
    const prefix = '系统 😀\n';
    const block = encodeMemoryBlock(snapshot);
    const prompt = `${prefix}${block}\n后续规则`;
    const range = { start: prefix.length, end: prefix.length + block.length };
    expect(decodeMemoryBlock(prompt, range)).toEqual(snapshot);
    expect(prompt.match(/Quoted data/g)).toHaveLength(1);
  });

  it('reads structurally valid historical blocks larger than the current fixed-recall budget', () => {
    const large: MemoryRequestSnapshot = {
      ...snapshot,
      entries: [{ ...entry, body: '汉'.repeat(16_000) }],
    };
    const text = encodeMemoryBlock(large);
    expect(decodeMemoryBlock(text, { start: 0, end: text.length })).toEqual(large);
  });

  it.each([
    { start: -1, end: 10 },
    { start: 0.5, end: 10 },
    { start: 10, end: 1 },
    { start: 0, end: Number.MAX_SAFE_INTEGER },
    { start: 1, end: 1 },
  ])('rejects invalid recorded range $start:$end', (range) => {
    expect(() => decodeMemoryBlock('{}', range)).toThrow('recorded memory block');
  });

  it('rejects offsets splitting a surrogate pair and valid JSON with invalid durable fields', () => {
    const block = encodeMemoryBlock(snapshot);
    expect(() => decodeMemoryBlock(`😀${block}`, { start: 1, end: block.length + 2 })).toThrow();
    for (const value of [
      { ...snapshot, ownerUserId: 'injected-owner' },
      { ...snapshot, entries: [{ ...snapshot.entries[0], revision: 0 }] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], scope: { kind: 'all' } }] },
      { ...snapshot, entries: [snapshot.entries[0], snapshot.entries[0]] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], body: ' ' }] },
    ]) {
      const text = JSON.stringify(value);
      expect(() => decodeMemoryBlock(text, { start: 0, end: text.length })).toThrow();
    }
    expect(() => decodeMemoryBlock(block, { start: 0, end: block.length - 1 })).toThrow();
  });
});
