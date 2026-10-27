import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { FrozenSkill, MessageView, RunView } from '@my-pi-harness/protocol';
import { afterEach, expect, it } from 'vitest';
import { openProfileStore, type EventInput, type ProfileStore } from '../src/index.js';

const owned: { directory: string; store: ProfileStore }[] = [];
afterEach(async () => {
  for (const entry of owned.splice(0)) {
    entry.store.close();
    await rm(entry.directory, { recursive: true, force: true });
  }
});
function skill(name: string, content = name): FrozenSkill {
  return {
    selection: { id: name, contentHash: createHash('sha256').update(content).digest('hex') },
    authorization: { skillEpoch: 1, pluginId: null, pluginEpoch: 0, pluginGeneration: null },
    name,
    description: name,
    scope: 'user',
    source: '/owned/fixture',
    content,
    resources: [],
    allowedTools: [],
  };
}
function event(
  type: string,
  data: Record<string, unknown>,
  privateData?: unknown,
  runId = 'run',
): EventInput {
  return {
    type,
    runId,
    at: 2,
    data,
    ...(privateData === undefined ? {} : { privateData: JSON.stringify(privateData) }),
  };
}
function message(id: string, role: MessageView['role'], runId = 'run'): EventInput {
  return event(
    'message.started',
    {
      id,
      sessionId: 'session',
      branchId: 'main',
      runId,
      role,
      text: id,
      thinking: '',
      createdAt: 2,
      status: 'complete',
      stopReason: role === 'assistant' ? 'stop' : null,
    },
    undefined,
    runId,
  );
}
function load(revision: number, skills: readonly FrozenSkill[]): EventInput {
  return event(
    'run.tools_loaded',
    { revision, names: [], skills: skills.map((item) => item.selection) },
    { version: 1, revision, tools: [], skills },
  );
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'skill-context-'));
  const store = await openProfileStore(directory);
  const entry = { directory, store };
  owned.push(entry);
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Skills',
    providerId: 'p',
    modelId: 'm',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  return entry;
}
function accept(skills: readonly FrozenSkill[], runId = 'run'): EventInput {
  const run: RunView = {
    id: runId,
    sessionId: 'session',
    branchId: 'main',
    providerId: 'p',
    modelId: 'm',
    status: 'running',
    createdAt: 2,
    finishedAt: null,
    error: null,
  };
  return event(
    'run.accepted',
    { run, requestId: `request-${runId}` },
    { tools: [], toolSources: [], skills },
    runId,
  );
}

it('reads accepted and loaded frozen instructions only at visible branch-prefix anchors, including after reopening', async () => {
  const entry = await fixture();
  const first = skill('github', 'FROZEN_GITHUB_BODY');
  const second = skill('documents', 'FROZEN_DOCUMENT_BODY');
  const hidden = skill('pdf', 'EXCLUDED_LATE_BODY');
  entry.store.append('session', [
    accept([first]),
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
    load(2, [first, second]),
    message('user-2', 'user'),
    load(3, [first, second, hidden]),
    message('assistant-2', 'assistant'),
    event('run.finished', { status: 'completed', finishedAt: 3, error: null }),
  ]);
  expect(entry.store.getSkillContext('session', 'main')).toEqual([first, second, hidden]);
  expect(entry.store.getSkillContext('session', 'main', ['user-1'])).toEqual([first]);
  expect(entry.store.getSkillContext('session', 'main', ['user-1', 'assistant-1'])).toEqual([
    first,
    second,
  ]);
  expect(entry.store.getSkillContext('session', 'main', [])).toEqual([]);
  entry.store.append('session', [
    {
      type: 'branch.created',
      runId: null,
      at: 4,
      data: {
        id: 'edited',
        sessionId: 'session',
        parentId: 'main',
        forkMessageId: 'user-2',
        createdAt: 4,
      },
    },
  ]);
  expect(entry.store.getSkillContext('session', 'edited')).toEqual([first, second]);
  entry.store.close();
  entry.store = await openProfileStore(entry.directory);
  expect(entry.store.getSkillContext('session', 'edited')).toEqual([first, second]);
  expect(() => entry.store.getSkillContext('session', 'edited', ['user-2'])).toThrow(
    'selected branch',
  );
  expect(() => entry.store.getSkillContext('another-session', 'edited')).toThrow('active session');
});

it('does not inherit a Run whose initial user message was excluded by an edit', async () => {
  const entry = await fixture();
  entry.store.append('session', [
    accept([skill('github')]),
    message('user-1', 'user'),
    event('run.finished', { status: 'completed', finishedAt: 3, error: null }),
  ]);
  entry.store.append('session', [
    {
      type: 'branch.created',
      runId: null,
      at: 4,
      data: {
        id: 'edited',
        sessionId: 'session',
        parentId: 'main',
        forkMessageId: 'user-1',
        createdAt: 4,
      },
    },
  ]);
  expect(entry.store.getSkillContext('session', 'edited')).toEqual([]);
});

it('scans multiple event batches while retaining only the latest sixteen distinct Skill versions', async () => {
  const entry = await fixture();
  const expected: FrozenSkill[] = [];
  for (let index = 0; index < 21; index += 1) {
    const runId = `run-${index}`;
    const frozen = skill(`skill-${index}`);
    expected.push(frozen);
    entry.store.append('session', [
      accept([frozen], runId),
      message(`user-${index}`, 'user', runId),
      event('run.finished', { status: 'completed', finishedAt: 3, error: null }, undefined, runId),
    ]);
  }
  expect(entry.store.getSkillContext('session', 'main')).toEqual(expected.slice(-16));
});

it('rejects non-object activation payloads instead of treating their missing skills field as empty', async () => {
  for (const payload of ['[]', '"opaque"', '42', 'null', 'not-json']) {
    const entry = await fixture();
    entry.store.append('session', [
      { ...accept([]), privateData: payload },
      message('user', 'user'),
    ]);
    expect(() => entry.store.getSkillContext('session', 'main')).toThrow(
      expect.objectContaining({ code: 'INVALID_RECORD' }),
    );
  }
});
