import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Type } from 'typebox';
import { initialWorkState, type HarnessEvent } from '@my-pi-harness/protocol';
import { openProfileStore } from '../src/profile/open.js';
import type { ProfileStore } from '../src/profile/store.js';
import {
  decodeJournalRecords,
  encodeJournalRecords,
  type JournalRecord,
} from '../src/sessions/journal-codec.js';
import { SessionBatchSchema } from '../src/sessions/session-jsonl.js';
import { sessionLogDirectory } from '../src/sessions/session-log-directory.js';
import { checked } from '../src/shared/validation.js';

interface Fixture {
  root: string;
  profile: string;
  logRoot: string;
  journal: string;
  store: ProfileStore;
}

const fixtures: Fixture[] = [];
const object = Type.Record(Type.String(), Type.Unknown());

function event(type: string, data: HarnessEvent['data'], seq = 1): HarnessEvent {
  return {
    version: 1,
    eventId: `event-${seq}`,
    sessionId: 'session',
    runId: null,
    seq,
    type,
    at: seq,
    data,
  };
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'my-pi-stored-event-'));
  const profile = join(root, 'profile');
  const logRoot = join(root, '.my-pi-harness');
  const store = await openProfileStore(profile, { sessionLogRoot: logRoot });
  const value = {
    root,
    profile,
    logRoot,
    store,
    journal: join(sessionLogDirectory(await realpath(profile), logRoot), 'session.jsonl'),
  };
  fixtures.push(value);
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Durable',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  const state = {
    ...initialWorkState('main'),
    revision: 1,
    todos: [
      {
        id: 'todo',
        title: 'Keep this task',
        status: 'pending' as const,
        planStepId: null,
        evidenceToolCallIds: [],
        completionNote: null,
      },
    ],
  };
  store.append('session', [
    { type: 'work.updated', runId: null, at: 2, data: { state } },
    {
      type: 'checkpoint.created',
      runId: null,
      at: 3,
      data: {
        checkpoint: {
          id: 'checkpoint',
          sessionId: 'session',
          branchId: 'main',
          label: 'Before',
          createdAt: 3,
          messageIds: [],
          state,
        },
      },
    },
  ]);
  return value;
}

async function editStoredWork(
  value: Fixture,
  edit: (state: Record<string, unknown>) => void,
): Promise<string> {
  value.store.close();
  const source = await readFile(value.journal, 'utf8');
  const lines = source
    .trimEnd()
    .split('\n')
    .map((line) => {
      const input: unknown = JSON.parse(line);
      const batch = checked(SessionBatchSchema, input);
      Object.assign(batch, { version: 3, oldWriter: 'retired' });
      for (const record of batch.records) {
        Object.assign(record.event, { oldEnvelope: 'retired' });
        if (record.event.type === 'work.updated') {
          edit(checked(object, record.event.data['state']));
        } else if (record.event.type === 'checkpoint.created') {
          const checkpoint = checked(object, record.event.data['checkpoint']);
          edit(checked(object, checkpoint['state']));
        }
      }
      const { checksum: _priorChecksum, ...body } = batch;
      return JSON.stringify({
        ...body,
        checksum: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      });
    });
  const updated = `${lines.join('\n')}\n`;
  await writeFile(value.journal, updated);
  return updated;
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

describe('durable event projection', () => {
  it.each(['constructor', 'toString', '__proto__'])(
    'preserves unregistered audit types named %s without using object prototype members',
    (type) => {
      const source: JournalRecord = { event: event(type, { retained: true }), privateData: null };
      expect(decodeJournalRecords([source], new Map()).records).toEqual([source]);
    },
  );
  it('replays retired fields in work and nested checkpoint states without rewriting the journal', async () => {
    const value = await fixture();
    const original = await editStoredWork(value, (state) => {
      state['mode'] = 'plan';
      state['oldField'] = { retired: true };
    });
    value.store = await openProfileStore(value.profile, { sessionLogRoot: value.logRoot });
    expect(value.store.getWorkState('session')).toEqual({
      ...initialWorkState('main'),
      revision: 1,
      todos: [
        {
          id: 'todo',
          title: 'Keep this task',
          status: 'pending',
          planStepId: null,
          evidenceToolCallIds: [],
          completionNote: null,
        },
      ],
    });
    const checkpoint = value.store.listCheckpoints('session')[0];
    expect(checkpoint?.state).toEqual(value.store.getWorkState('session'));
    const events = value.store.readEvents('session');
    expect(events[0]).not.toHaveProperty('oldEnvelope');
    expect(events.find((entry) => entry.type === 'work.updated')?.data['state']).not.toHaveProperty(
      'mode',
    );
    expect(await readFile(value.journal, 'utf8')).toBe(original);
    expect(() =>
      value.store.append('session', [
        {
          type: 'work.updated',
          runId: null,
          at: 4,
          data: { state: { ...value.store.getWorkState('session'), revision: 2, mode: 'plan' } },
        },
      ]),
    ).toThrow('failed validation');
    expect(await readFile(value.journal, 'utf8')).toBe(original);
  });

  it.each(['missing', 'type', 'union', 'relationship'] as const)(
    'still rejects malformed core work data (%s)',
    async (kind) => {
      const value = await fixture();
      await editStoredWork(value, (state) => {
        state['mode'] = 'plan';
        if (kind === 'missing') delete state['branchId'];
        if (kind === 'type') state['revision'] = '1';
        if (kind === 'union')
          state['todos'] = [
            {
              id: 'todo',
              title: 'Invalid',
              status: 'future',
              planStepId: null,
              evidenceToolCallIds: [],
              completionNote: null,
            },
          ];
        if (kind === 'relationship') state['branchId'] = 'foreign';
      });
      await expect(
        openProfileStore(value.profile, { sessionLogRoot: value.logRoot }),
      ).rejects.toThrow();
    },
  );

  it('keeps private codecs and request reference baselines intact while selecting public fields', () => {
    const messages = [{ message: { role: 'system', content: 'prompt', mode: 'private metadata' } }];
    const first: JournalRecord = {
      event: event('context.prepared', { branchId: 'main', retired: true }),
      privateData: { version: 1, systemPrompt: 'prompt', messages },
    };
    first.event.runId = 'run';
    const before = structuredClone(first);
    const encoded = encodeJournalRecords([first], new Map());
    const decoded = decodeJournalRecords(encoded.records, new Map());
    expect(decoded.records[0]?.event.data).toEqual({ branchId: 'main' });
    expect(decoded.records[0]?.privateData).toEqual(before.privateData);
    expect(first).toEqual(before);
    const next = { ...first, event: { ...first.event, seq: 2 } };
    const encodedNext = encodeJournalRecords([next], encoded.state);
    expect(encodedNext.records[0]?.privateData?.['messages']).toEqual([0]);
    const restored = decodeJournalRecords(encodedNext.records, decoded.state);
    expect(restored.records[0]?.privateData).toEqual(before.privateData);
  });

  it('keeps arbitrary tool arguments and extension audit data rather than treating their keys as DTO fields', () => {
    const argumentsValue = { mode: 'application option', nested: { retired: 'business value' } };
    const record: JournalRecord = {
      event: event('tool.requested', {
        tool: {
          id: 'tool',
          sessionId: 'session',
          branchId: 'main',
          runId: 'run',
          name: 'read_file',
          arguments: argumentsValue,
          binding: {
            kind: 'accepted',
            source: { kind: 'workspace', obsolete: true },
            fingerprint: 'f'.repeat(64),
          },
          dispatch: { state: 'not_applicable' },
          status: 'running',
          summary: '',
          result: null,
          diff: null,
          createdAt: 1,
          updatedAt: 1,
          obsolete: true,
        },
      }),
      privateData: { arbitrary: { mode: 'keep' } },
    };
    const audit: JournalRecord = {
      event: event('run.progress', { mode: 'keep', nested: { field: 1 } }, 2),
      privateData: null,
    };
    const decoded = decodeJournalRecords([record, audit], new Map());
    const tool = checked(object, decoded.records[0]?.event.data['tool']);
    expect(tool['arguments']).toEqual(argumentsValue);
    expect(tool).not.toHaveProperty('obsolete');
    expect(tool['binding']).toEqual({
      kind: 'accepted',
      source: { kind: 'workspace' },
      fingerprint: 'f'.repeat(64),
    });
    expect(decoded.records[0]?.privateData).toEqual(record.privateData);
    expect(decoded.records[1]?.event).toEqual(audit.event);
  });
});
