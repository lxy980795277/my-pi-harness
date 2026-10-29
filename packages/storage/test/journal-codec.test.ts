import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import type { StoredToolResult } from '@my-pi-harness/protocol';
import {
  decodeJournalRecords,
  encodeJournalRecords,
  type JournalCodecState,
  type JournalRecord,
} from '../src/sessions/journal-codec.js';
import { PrivateSessionFiles } from '../src/sessions/private-files.js';
import { SessionJournal, SessionBatchSchema } from '../src/sessions/session-jsonl.js';
import { checked } from '../src/shared/validation.js';

const resources: { directory: string; files: PrivateSessionFiles }[] = [];
const objectSchema = Type.Record(Type.String(), Type.Unknown());

function privatePayload(record: JournalRecord | undefined): Record<string, unknown> {
  if (record?.privateData === undefined || record.privateData === null)
    throw new Error('Fixture private data is missing');
  return record.privateData;
}

function toolPayload(record: JournalRecord | undefined): Record<string, unknown> {
  return checked(objectSchema, record?.event.data['tool']);
}

function diskBatch(line: string | undefined) {
  if (line === undefined) throw new Error('Fixture journal line is missing');
  const value: unknown = JSON.parse(line);
  return checked(SessionBatchSchema, value);
}

function message(role: 'system' | 'user' | 'assistant', content: string): Record<string, unknown> {
  return { sdkVersion: '1.1.0', message: { role, content, timestamp: 1 }, codecVersion: 1 };
}

function request(
  seq: number,
  messages: Record<string, unknown>[] = [message('system', 'prompt'), message('user', 'hello')],
  branchId = 'main',
  prompt = 'prompt',
): JournalRecord {
  return {
    event: {
      version: 1,
      eventId: `event-${seq}`,
      sessionId: 'session',
      runId: 'run',
      seq,
      type: 'context.prepared',
      at: seq,
      data: { branchId },
    },
    privateData: { messages, systemPrompt: prompt, version: 1 },
  };
}

function toolRecords(result = 'result', content = 'result'): JournalRecord[] {
  const terminal: JournalRecord = {
    ...request(1),
    event: {
      ...request(1).event,
      type: 'tool.updated',
      data: { tool: { id: 'tool', result, diff: 'separate diff', status: 'completed' } },
    },
    privateData: null,
  };
  const canonical: StoredToolResult = {
    toolResultVersion: 1,
    providerCallId: 'provider-tool',
    toolName: 'read_file',
    content: [{ type: 'text', text: content }],
    isError: false,
    at: 1,
    outcome: 'completed',
    origin: 'tool',
  };
  return [
    terminal,
    {
      event: { ...request(2).event, type: 'tool.context', data: { toolCallId: 'tool' } },
      privateData: canonical,
    },
  ];
}

function finished(seq: number): JournalRecord {
  return {
    event: {
      ...request(seq).event,
      type: 'run.finished',
      data: { status: 'completed', finishedAt: seq, error: null },
    },
    privateData: null,
  };
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-journal-codec-')));
  const files = new PrivateSessionFiles(directory);
  resources.push({ directory, files });
  return {
    directory,
    files,
    journal: new SessionJournal(files),
    path: join(files.directory, 'session.jsonl'),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { directory, files } of resources.splice(0)) {
    files.close();
    await rm(directory, { recursive: true, force: true });
  }
});

describe('journal request encoding', () => {
  it('keeps parent and sibling request references when a child Run finishes', () => {
    const parent = request(1);
    const child = request(2);
    child.event.runId = 'child';
    const sibling = request(3);
    sibling.event.runId = 'sibling';
    const initial = encodeJournalRecords([parent, child, sibling], new Map());
    const terminal = finished(4);
    terminal.event.runId = 'child';
    const nextParent = request(5);
    const nextSibling = request(6);
    nextSibling.event.runId = 'sibling';
    const ending = encodeJournalRecords([terminal], initial.state);
    const next = encodeJournalRecords([nextParent, nextSibling], ending.state);
    expect(privatePayload(next.records[0])['messages']).toEqual([0, 1]);
    expect(privatePayload(next.records[1])['messages']).toEqual([0, 1]);
    expect(ending.state.has('child')).toBe(false);
    expect(ending.state.size).toBe(2);
    expect(initial.state.size).toBe(3);
    const initialDecoded = decodeJournalRecords(initial.records, new Map());
    const endingDecoded = decodeJournalRecords(ending.records, initialDecoded.state);
    const nextDecoded = decodeJournalRecords(next.records, endingDecoded.state);
    expect(nextDecoded.records).toEqual([nextParent, nextSibling]);
    const selfContained = encodeJournalRecords([nextParent], new Map());
    expect(decodeJournalRecords(selfContained.records, endingDecoded.state).records).toEqual([
      nextParent,
    ]);
    expect(endingDecoded.state.has('child')).toBe(false);
    expect(endingDecoded.state.size).toBe(2);
    const parentDone = encodeJournalRecords([finished(7)], next.state);
    expect(parentDone.state.size).toBe(1);
  });

  it('persists interleaved Run references across journal appends and restores their exact private requests', async () => {
    const { journal, files, path } = await fixture();
    const parent = request(1);
    const child = request(2);
    child.event.runId = 'child';
    const sibling = request(3);
    sibling.event.runId = 'sibling';
    const terminal = finished(4);
    terminal.event.runId = 'child';
    const nextParent = request(5);
    const nextSibling = request(6);
    nextSibling.event.runId = 'sibling';
    journal.append('session', [parent, child, sibling]);
    journal.append('session', [terminal]);
    journal.append('session', [nextParent, nextSibling]);
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
    const last = diskBatch(lines.at(-1));
    expect(last.records.map((record) => privatePayload(record)['messages'])).toEqual([
      [0, 1],
      [0, 1],
    ]);
    const recovered = new SessionJournal(files);
    expect([...recovered.read('session')].flat()).toEqual([
      parent,
      child,
      sibling,
      terminal,
      nextParent,
      nextSibling,
    ]);
    const later = request(7);
    later.event.runId = 'sibling';
    recovered.append('session', [later]);
    const finalLines = (await readFile(path, 'utf8')).trimEnd().split('\n');
    expect(privatePayload(diskBatch(finalLines.at(-1)).records[0])['messages']).toEqual([0, 1]);
  });

  it('stores native private objects and restores prompts and repeated messages with their key order', () => {
    const initial = request(1);
    const first = encodeJournalRecords([initial], new Map());
    expect(first.records[0]?.privateData).toEqual({
      messages: initial.privateData?.['messages'],
      systemPrompt: 0,
      version: 1,
    });
    const messages = [
      message('system', 'prompt'),
      message('user', 'hello'),
      message('assistant', 'answer'),
    ];
    const next = request(2, messages);
    const second = encodeJournalRecords([next], first.state);
    expect(second.records[0]?.privateData?.['messages']).toEqual([0, 1, messages[2]]);
    const firstDecoded = decodeJournalRecords(first.records, new Map());
    const secondDecoded = decodeJournalRecords(second.records, firstDecoded.state);
    expect(JSON.stringify(firstDecoded.records)).toBe(JSON.stringify([initial]));
    expect(JSON.stringify(secondDecoded.records)).toBe(JSON.stringify([next]));
  });

  it('keeps different prompt text and treats different object key order as distinct messages', () => {
    const first = encodeJournalRecords([request(1)], new Map());
    const reordered = {
      codecVersion: 1,
      message: { content: 'hello', role: 'user', timestamp: 1 },
      sdkVersion: '1.1.0',
    };
    const next = request(2, [message('system', 'prompt'), reordered], 'main', 'separate prompt');
    const encoded = encodeJournalRecords([next], first.state);
    expect(encoded.records[0]?.privateData?.['systemPrompt']).toBe('separate prompt');
    expect(encoded.records[0]?.privateData?.['messages']).toEqual([0, reordered]);
    expect(JSON.stringify(decodeJournalRecords(encoded.records, first.state).records)).toBe(
      JSON.stringify([next]),
    );
  });

  it('uses only the previous snapshot of the same branch, including requests within one batch', () => {
    const main = request(1);
    const other = request(2, undefined, 'other');
    const nextMain = request(3);
    const encoded = encodeJournalRecords([main, other, nextMain], new Map());
    expect(encoded.records[1]?.privateData?.['messages']).toEqual(other.privateData?.['messages']);
    expect(encoded.records[2]?.privateData?.['messages']).toEqual([0, 1]);
    expect(decodeJournalRecords(encoded.records, new Map()).records).toEqual([
      main,
      other,
      nextMain,
    ]);
  });

  it('does not share baselines with caller inputs or returned decoded messages', () => {
    const initial = request(1);
    const first = encodeJournalRecords([initial], new Map());
    privatePayload(initial)['messages'] = [];
    const decoded = decodeJournalRecords(first.records, new Map());
    privatePayload(decoded.records[0])['messages'] = [];
    const next = encodeJournalRecords([request(2)], decoded.state);
    expect(next.records[0]?.privateData?.['messages']).toEqual([0, 1]);
    expect(first.state.get('run')?.get('main')).toHaveLength(2);
  });

  it('releases completed Run baselines and never references another Run', () => {
    const first = encodeJournalRecords([request(1)], new Map());
    const next = request(3);
    next.event.runId = 'next-run';
    const encoded = encodeJournalRecords([next], first.state);
    expect(encoded.records[0]?.privateData?.['messages']).toEqual(next.privateData?.['messages']);
    const invalid = structuredClone(next);
    privatePayload(invalid)['messages'] = [0];
    expect(() => decodeJournalRecords([invalid], first.state)).toThrow('reference');
    const terminal = encodeJournalRecords([finished(2)], first.state);
    expect(terminal.state.size).toBe(0);
    const replayed = decodeJournalRecords([...first.records, ...terminal.records], new Map());
    expect(replayed.state.size).toBe(0);
    expect(first.state.size).toBe(1);
  });

  it('rejects request snapshots without a Run', () => {
    const input = request(1);
    input.event.runId = null;
    expect(() => encodeJournalRecords([input], new Map())).toThrow('requires a Run');
    expect(() => decodeJournalRecords([input], new Map())).toThrow('requires a Run');
  });

  it.each([-1, 0.5, 99])('rejects invalid previous-message index %s', (index) => {
    const baseline = encodeJournalRecords([request(1)], new Map()).state;
    const invalid = request(2);
    privatePayload(invalid)['messages'] = [index];
    expect(() => decodeJournalRecords([invalid], baseline)).toThrow();
  });

  it('rejects references without a preceding request and across branches', () => {
    const input = request(1);
    privatePayload(input)['messages'] = [0];
    expect(() => decodeJournalRecords([input], new Map())).toThrow('reference');
    const other: JournalCodecState = new Map([
      ['run', new Map([['other', [message('system', 'prompt')]]])],
    ]);
    expect(() => decodeJournalRecords([input], other)).toThrow('reference');
  });

  it.each([
    { version: 2, systemPrompt: 'prompt', messages: [] },
    { version: 1, systemPrompt: 'prompt', messages: [], unknown: true },
    { version: 1, systemPrompt: 'prompt', messages: ['stringified codec'] },
    { version: 1, systemPrompt: 1, messages: [] },
    { version: 1, systemPrompt: 0, messages: [] },
    { version: 1, systemPrompt: 0, messages: [message('user', 'not a system prompt')] },
  ])('rejects unsupported request headers and prompt references %#', (privateData) => {
    expect(() => decodeJournalRecords([{ ...request(1), privateData }], new Map())).toThrow();
  });

  it('does not advance the supplied baseline when a later record fails', () => {
    const previous = encodeJournalRecords([request(1)], new Map()).state;
    const before = structuredClone(previous);
    const changed = request(2, [message('system', 'prompt'), message('user', 'changed')]);
    const invalid = request(3);
    privatePayload(invalid)['messages'] = [99];
    expect(() => decodeJournalRecords([changed, invalid], previous)).toThrow('reference');
    expect(previous).toEqual(before);
  });
});

describe('journal canonical tool results', () => {
  it('stores identical terminal text only in canonical content and restores exact public key order', () => {
    const original = toolRecords();
    const encoded = encodeJournalRecords(original, new Map());
    expect(encoded.records[0]?.event.data['tool']).toEqual({
      id: 'tool',
      result: { from: 'tool.context' },
      diff: 'separate diff',
      status: 'completed',
    });
    expect(JSON.stringify(decodeJournalRecords(encoded.records, new Map()).records)).toBe(
      JSON.stringify(original),
    );
    expect(original[0]?.event.data['tool']).toHaveProperty('result', 'result');
  });

  it.each(['richer public result', 'res'])(
    'keeps distinct or truncated public text (%s)',
    (result) => {
      const original = toolRecords(result);
      const encoded = encodeJournalRecords(original, new Map());
      expect(encoded.records[0]?.event.data['tool']).toHaveProperty('result', result);
      expect(decodeJournalRecords(encoded.records, new Map()).records).toEqual(original);
    },
  );

  it('retains canonical images alongside referenced text', () => {
    const original = toolRecords();
    const content = privatePayload(original[1])['content'];
    if (!Array.isArray(content)) throw new Error('Fixture content is missing');
    content.push({ type: 'image', data: 'YQ==', mimeType: 'image/png' });
    const encoded = encodeJournalRecords(original, new Map());
    expect(decodeJournalRecords(encoded.records, new Map()).records).toEqual(original);
  });

  it.each([{ from: 'tool.context', extra: true }, { from: 'other' }])(
    'rejects unknown tool result marker fields %#',
    (marker) => {
      const records = toolRecords();
      const tool = toolPayload(records[0]);
      tool['result'] = marker;
      expect(() => decodeJournalRecords(records, new Map())).toThrow('reference');
    },
  );

  it('requires a matching canonical result in the same batch and a terminal status', () => {
    const records = encodeJournalRecords(toolRecords(), new Map()).records;
    expect(() => decodeJournalRecords(records.slice(0, 1), new Map())).toThrow('reference');
    const tool = toolPayload(records[0]);
    tool['status'] = 'running';
    expect(() => decodeJournalRecords(records, new Map())).toThrow('reference');
  });
});

describe('journal reference replay', () => {
  it('keeps newly appended event envelopes strict before creating journal bytes', async () => {
    const { journal, path } = await fixture();
    const source = request(1);
    const record = { ...source, event: { ...source.event, retiredMetadata: true } };
    expect(() => journal.append('session', [record])).toThrow('failed validation');
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores request baselines on restart before encoding the next append', async () => {
    const { files, journal, path } = await fixture();
    journal.append('session', [request(1)]);
    const reopened = new SessionJournal(files);
    expect([...reopened.read('session')].flat()).toEqual([request(1)]);
    reopened.append('session', [request(2)]);
    const disk = (await readFile(path, 'utf8')).trimEnd().split('\n').map(diskBatch);
    expect(Object.keys(disk[1] ?? {})).toEqual(['records', 'checksum']);
    expect(disk[1]?.records[0]?.privateData?.['messages']).toEqual([0, 1]);
    const download = reopened.openDownload('session');
    try {
      expect(await buffer(download.content)).toEqual(await readFile(path));
    } finally {
      download.content.destroy();
    }
    expect([...new SessionJournal(files).read('session')].flat()).toEqual([request(1), request(2)]);
  });

  it('does not advance request references when an append fails before writing', async () => {
    const { files, journal, path } = await fixture();
    journal.append('session', [request(1)]);
    const check = vi.spyOn(files, 'checkFile').mockImplementationOnce(() => {
      throw new Error('Fixture file check failure');
    });
    try {
      expect(() =>
        journal.append('session', [
          request(2, [message('system', 'prompt'), message('user', 'not committed')]),
        ]),
      ).toThrow('Fixture file check failure');
    } finally {
      check.mockRestore();
    }
    journal.append('session', [request(2)]);
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
    const second = diskBatch(lines[1]);
    expect(second.records[0]?.privateData?.['messages']).toEqual([0, 1]);
    expect([...new SessionJournal(files).read('session')].flat()).toEqual([request(1), request(2)]);
  });

  it('starts a complete new Run snapshot after replaying a terminal Run', async () => {
    const { files, journal, path } = await fixture();
    journal.append('session', [request(1), finished(2)]);
    const reopened = new SessionJournal(files);
    expect([...reopened.read('session')].flat()).toEqual([request(1), finished(2)]);
    const next = request(3);
    next.event.runId = 'next-run';
    reopened.append('session', [next]);
    const second = diskBatch((await readFile(path, 'utf8')).split('\n')[1]);
    expect(second.records[0]?.privateData?.['messages']).toEqual(next.privateData?.['messages']);
    expect([...new SessionJournal(files).read('session')].flat()).toEqual([
      request(1),
      finished(2),
      next,
    ]);
  });

  it('rejects a checksum-valid bad request reference during journal replay', async () => {
    const { files, journal, path } = await fixture();
    journal.append('session', [request(1)]);
    journal.append('session', [request(2)]);
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
    const second = diskBatch(lines[1]);
    privatePayload(second.records[0])['messages'] = [99];
    const body = { records: second.records };
    second.checksum = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    await writeFile(path, `${lines[0]}\n${JSON.stringify(second)}\n`);
    expect(() => [...new SessionJournal(files).read('session')]).toThrow('replayed safely');
  });
});
