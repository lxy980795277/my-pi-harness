import { describe, expect, it } from 'vitest';
import { encodeMemoryBlock } from '@my-pi-harness/memory/snapshot';
import type { MemoryRequestSnapshot } from '@my-pi-harness/protocol/internal';
import {
  encodeJournalRecords,
  decodeJournalRecords,
  type JournalRecord,
} from '../src/sessions/journal-codec';
import { preparedMemory } from '../src/sessions/memory-adoption';
import { checked } from '../src/shared/validation';
import { PreparedPrivateSchema } from '../src/sessions/event-validation';

const adopted: MemoryRequestSnapshot = {
  fingerprint: 'a'.repeat(64),
  entries: [
    {
      id: 'remembered',
      scope: { kind: 'user' },
      category: 'fact',
      body: '中文 🌕 "quoted" fact',
      revision: 1,
      source: { kind: 'manual' },
    },
  ],
};

function readPreparedMemory(value: unknown): MemoryRequestSnapshot | null {
  return preparedMemory(checked(PreparedPrivateSchema, value));
}

function request(seq: number): JournalRecord {
  const prefix = 'Reference data 🪐\n';
  const systemPrompt = prefix + encodeMemoryBlock(adopted);
  return {
    event: {
      version: 1,
      eventId: `event-${seq}`,
      sessionId: 'session',
      runId: 'run',
      seq,
      type: 'context.prepared',
      at: seq,
      data: { branchId: 'main' },
    },
    privateData: {
      version: 1,
      systemPrompt,
      memoryRange: { start: prefix.length, end: systemPrompt.length },
      messages: [
        {
          codecVersion: 1,
          sdkVersion: '1.4.0',
          message: { role: 'system', content: systemPrompt, timestamp: 1 },
        },
      ],
    },
  };
}

describe('adopted memory in compact request journals', () => {
  it('keeps bounded selection explanations outside the only recorded prompt body', () => {
    const value = request(1);
    if (!value.privateData) throw new Error('missing request');
    const selection = {
      retrieval: 'hybrid',
      candidateCount: 2,
      matchedCount: 1,
      omittedCount: 1,
      verification: 'local-model',
      omissions: [{ id: 'unselected', revision: 1, mode: 'relevant', reason: 'unverified' }],
    };
    value.privateData['memorySelection'] = selection;
    const stored = encodeJournalRecords([value], new Map());
    expect(JSON.stringify(stored.records).match(/quoted/g)).toHaveLength(1);
    expect(value.privateData['systemPrompt']).not.toContain('verification');
    const restored = decodeJournalRecords(stored.records, new Map());
    expect(restored.records[0]?.privateData?.['memorySelection']).toEqual(selection);
    expect(readPreparedMemory(restored.records[0]?.privateData)).toEqual(adopted);
    const empty = request(2);
    if (!empty.privateData) throw new Error('missing request');
    empty.privateData = {
      version: 1,
      systemPrompt: 'No adopted memory',
      messages: [{ marker: 'base' }],
      memorySelection: { ...selection, verification: 'unavailable', matchedCount: 0 },
    };
    const encodedEmpty = encodeJournalRecords([empty], new Map());
    expect(
      readPreparedMemory(
        decodeJournalRecords(encodedEmpty.records, new Map()).records[0]?.privateData,
      ),
    ).toBeNull();
  });

  it('replays prior selection metadata without a verifier and rejects an unrecognized verifier', () => {
    const value = request(1);
    if (!value.privateData) throw new Error('missing request');
    const historical = {
      retrieval: 'hybrid',
      candidateCount: 1,
      matchedCount: 1,
      omittedCount: 0,
      omissions: [],
    };
    value.privateData['memorySelection'] = historical;
    const stored = encodeJournalRecords([value], new Map());
    expect(
      decodeJournalRecords(stored.records, new Map()).records[0]?.privateData?.['memorySelection'],
    ).toEqual(historical);
    value.privateData['memorySelection'] = { ...historical, verification: 'embedding-score' };
    expect(() => encodeJournalRecords([value], new Map())).toThrow();
  });

  it('stores one body and reconstructs its exact range after system and message references', () => {
    const first = encodeJournalRecords([request(1)], new Map());
    const second = encodeJournalRecords([request(2)], first.state);
    expect(JSON.stringify(first.records).match(/quoted/g)).toHaveLength(1);
    expect(second.records[0]?.privateData?.['messages']).toEqual([0]);
    const restoredFirst = decodeJournalRecords(first.records, new Map());
    const restoredSecond = decodeJournalRecords(second.records, restoredFirst.state);
    expect(readPreparedMemory(restoredFirst.records[0]?.privateData)).toEqual(adopted);
    expect(readPreparedMemory(restoredSecond.records[0]?.privateData)).toEqual(adopted);
  });

  it.each([
    { start: -1, end: 2 },
    { start: 999999, end: 1000000 },
    { start: 1, end: 1 },
  ])('rejects an invalid durable range %j', (memoryRange) => {
    const value = request(1);
    if (!value.privateData) throw new Error('Missing request');
    value.privateData['memoryRange'] = memoryRange;
    expect(() => encodeJournalRecords([value], new Map())).toThrow();
  });

  it('rejects an adoption block that differs from the actual Provider system message', () => {
    const value = request(1);
    if (!value.privateData) throw new Error('Missing request');
    value.privateData['messages'] = [
      { message: { role: 'system', content: 'a different provider prompt' } },
    ];
    expect(() => readPreparedMemory(value.privateData)).toThrow('actual leading system message');
  });

  it('does not substitute a current fact when the recorded JSON is malformed', () => {
    const value = request(1);
    if (!value.privateData) throw new Error('Missing request');
    value.privateData['systemPrompt'] = 'not-json';
    value.privateData['memoryRange'] = { start: 0, end: 8 };
    expect(() => readPreparedMemory(value.privateData)).toThrow();
  });
});
