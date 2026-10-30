import { createHash } from 'node:crypto';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Type } from 'typebox';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, sessionLogDirectory } from '../src/index.js';
import { SessionBatchSchema } from '../src/sessions/session-jsonl.js';
import { checked } from '../src/shared/validation.js';
import { createAgentSession, spawn, type AgentSessionFixture } from './fixtures/agent-session.js';

const fixtures: AgentSessionFixture[] = [];
const object = Type.Record(Type.String(), Type.Unknown());

async function fixture(): Promise<AgentSessionFixture> {
  const value = await createAgentSession();
  fixtures.push(value);
  return value;
}

function replaceSettings(value: AgentSessionFixture, input: unknown): string {
  value.store.close();
  const database = new Database(join(value.directory, 'data.sqlite'));
  const data = JSON.stringify(input);
  try {
    database.prepare('UPDATE agent_settings SET data = ? WHERE id = 1').run(data);
  } finally {
    database.close();
  }
  return data;
}

async function editTaskLimits(
  value: AgentSessionFixture,
  edit: (limits: Record<string, unknown>) => void,
): Promise<{ path: string; source: string }> {
  value.store.recoverInterrupted();
  value.store.close();
  const profile = await realpath(value.directory);
  const path = join(sessionLogDirectory(profile, join(profile, '.my-pi-harness')), 'session.jsonl');
  const original = await readFile(path, 'utf8');
  expect(original).not.toContain('tokenBudget');
  const lines = original
    .trimEnd()
    .split('\n')
    .map((line) => {
      const batch = checked(SessionBatchSchema, JSON.parse(line));
      for (const record of batch.records) {
        if (record.event.type !== 'task.created') continue;
        const task = checked(object, record.event.data['task']);
        edit(checked(object, task['limits']));
      }
      const { checksum: _priorChecksum, ...body } = batch;
      return JSON.stringify({
        ...body,
        checksum: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      });
    });
  const source = `${lines.join('\n')}\n`;
  await writeFile(path, source);
  return { path, source };
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

describe('persisted agent limit fields', () => {
  it('reads current settings fields without rewriting stored extras and keeps new writes strict', async () => {
    const value = await fixture();
    const saved = value.store.putAgentSettings(value.store.getAgentSettings());
    const previous = {
      ...saved,
      limits: { ...saved.limits, tokenBudget: 200_000 },
    };
    const data = replaceSettings(value, previous);
    value.store = await openProfileStore(value.directory);
    expect(value.store.getAgentSettings()).toEqual(saved);
    const database = new Database(join(value.directory, 'data.sqlite'));
    try {
      expect(database.prepare('SELECT data FROM agent_settings WHERE id = 1').get()).toEqual({
        data,
      });
    } finally {
      database.close();
    }
    expect(() => value.store.putAgentSettings(previous)).toThrow('failed validation');
    const updated = value.store.putAgentSettings(value.store.getAgentSettings());
    expect(updated).not.toHaveProperty('limits.tokenBudget');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getAgentSettings()).toEqual(updated);
  });

  it.each(['missing', 'type', 'range'] as const)(
    'rejects damaged required settings limits after projecting extras (%s)',
    async (kind) => {
      const value = await fixture();
      const saved = value.store.putAgentSettings(value.store.getAgentSettings());
      const limits: Record<string, unknown> = { ...saved.limits, tokenBudget: 200_000 };
      if (kind === 'missing') delete limits['maxOutputTokens'];
      if (kind === 'type') limits['maxConcurrentRequests'] = '4';
      if (kind === 'range') limits['maxTurns'] = 0;
      replaceSettings(value, { ...saved, limits });
      value.store = await openProfileStore(value.directory);
      expect(() => value.store.getAgentSettings()).toThrow(
        expect.objectContaining({ code: 'INVALID_RECORD' }),
      );
    },
  );

  it('replays nested retired task limits without rewriting the journal', async () => {
    const value = await fixture();
    const task = spawn(value.store, 'first');
    const journal = await editTaskLimits(value, (limits) => {
      limits['tokenBudget'] = 1024;
    });
    value.store = await openProfileStore(value.directory);
    expect(value.store.getAgentTask('session', 'first')?.limits).toEqual(task.limits);
    const created = value.store
      .readEvents('session')
      .find((entry) => entry.type === 'task.created');
    expect(created?.data['task']).not.toHaveProperty('limits.tokenBudget');
    expect(await readFile(journal.path, 'utf8')).toBe(journal.source);
  });

  it('still rejects a missing required task limit when retired fields are present', async () => {
    const value = await fixture();
    spawn(value.store, 'first');
    const journal = await editTaskLimits(value, (limits) => {
      limits['tokenBudget'] = 200_000;
      delete limits['maxOutputTokens'];
    });
    await expect(openProfileStore(value.directory)).rejects.toThrow('failed validation');
    expect(await readFile(journal.path, 'utf8')).toBe(journal.source);
  });
});
