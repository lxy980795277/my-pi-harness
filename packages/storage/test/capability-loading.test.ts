import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunView } from '@my-pi-harness/protocol';
import type { FrozenSkill, SkillCandidate, EventInput } from '@my-pi-harness/protocol/internal';
import { afterEach, expect, it } from 'vitest';
import { openProfileStore, type ProfileStore } from '../src/index';

interface NativeCandidate {
  definition: { name: string; description: string; parameters: Record<string, unknown> };
  source: { kind: 'session' | 'workspace' };
  fingerprint: string;
}

const owned: { directory: string; store: ProfileStore }[] = [];
const run: RunView = {
  id: 'run',
  sessionId: 'session',
  branchId: 'main',
  providerId: 'provider',
  modelId: 'model',
  status: 'running',
  createdAt: 2,
  finishedAt: null,
  error: null,
};
const native: NativeCandidate = {
  definition: {
    name: 'search_session_history',
    description: 'Search retained session history',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  },
  source: { kind: 'session' },
  fingerprint: 'a'.repeat(64),
};
const instructions: FrozenSkill = {
  selection: { id: 'github', contentHash: 'b'.repeat(64) },
  authorization: {
    skillEpoch: 1,
    pluginId: 'github',
    pluginEpoch: 2,
    pluginGeneration: 'installed-generation',
  },
  name: 'GitHub',
  description: 'Review a repository',
  scope: 'plugin',
  source: '/owned/plugins/github/skills/github',
  content: 'Read the repository before preparing a review.',
  resources: [],
  allowedTools: [],
};

afterEach(async () => {
  for (const entry of owned.splice(0)) {
    entry.store.close();
    await rm(entry.directory, { recursive: true, force: true });
  }
});

function candidate(skill: FrozenSkill): SkillCandidate {
  const { selection, authorization, name, description, scope, source } = skill;
  return { selection, authorization, name, description, scope, source };
}

function event(
  type: string,
  data: Record<string, unknown>,
  privateData?: Record<string, unknown>,
): EventInput {
  return { type, runId: 'run', at: 3, data, ...(privateData ? { privateData } : {}) };
}

async function fixture(
  nativeCandidates: readonly NativeCandidate[] = [],
  skillCandidates: readonly SkillCandidate[] = [],
  initial: readonly NativeCandidate[] = [],
  initialSkills: readonly FrozenSkill[] = [],
) {
  const directory = await mkdtemp(join(tmpdir(), 'capability-loading-'));
  const store = await openProfileStore(directory);
  const entry = { directory, store };
  owned.push(entry);
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Capabilities',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  store.append('session', [
    event(
      'run.accepted',
      { run, requestId: 'request' },
      {
        tools: initial.map((tool) => tool.definition),
        toolSources: initial.map(({ definition, source, fingerprint }) => ({
          name: definition.name,
          source,
          fingerprint,
        })),
        nativeCandidates,
        skillCandidates,
        skills: initialSkills,
      },
    ),
  ]);
  return entry;
}

function load(
  tools: readonly NativeCandidate[],
  skills: readonly FrozenSkill[] = [],
  revision = 2,
): EventInput {
  return event(
    'run.tools_loaded',
    {
      revision,
      names: tools.map((tool) => tool.definition.name),
      skills: skills.map((skill) => skill.selection),
    },
    { version: 1, revision, tools, skills },
  );
}

function queueMetadata(skills: readonly FrozenSkill[] = []): Record<string, unknown> {
  return {
    version: 1,
    requestId: 'queued-request',
    mcpBindings: [],
    candidateBindings: [],
    skillBindings: [],
    skillCandidates: [],
    mentionedSkillBindings: skills,
    inheritedSkillBindings: [],
    discoveryDiagnostics: [],
  };
}

function queuedInput(): EventInput {
  return event(
    'queue.added',
    {
      id: 'queued',
      sessionId: 'session',
      text: '$github please review',
      mode: 'steer',
      providerId: 'provider',
      modelId: 'model',
      createdAt: 3,
      updatedAt: 3,
      revision: 1,
    },
    queueMetadata([instructions]),
  );
}

it('loads an accepted session tool without changing its source and replays it after reopening', async () => {
  const entry = await fixture([native]);
  entry.store.append('session', [load([native])]);
  expect(entry.store.readEvents('session').at(-1)?.type).toBe('run.tools_loaded');
  entry.store.close();
  entry.store = await openProfileStore(entry.directory);
  expect(
    entry.store.readEvents('session').filter((value) => value.type === 'run.tools_loaded'),
  ).toHaveLength(1);
});

it.each(['source', 'fingerprint', 'schema', 'unknown'])(
  'rejects a native tool with changed %s before recording a load',
  async (change) => {
    const entry = await fixture([native]);
    const altered = structuredClone(native);
    if (change === 'source') altered.source.kind = 'workspace';
    if (change === 'fingerprint') altered.fingerprint = 'c'.repeat(64);
    if (change === 'schema') altered.definition.parameters = { type: 'object' };
    if (change === 'unknown') altered.definition.name = 'write_file';
    expect(() => entry.store.append('session', [load([altered])])).toThrow('not accepted');
    expect(entry.store.readEvents('session')).toHaveLength(2);
  },
);

it('rejects removing an already loaded native tool', async () => {
  const entry = await fixture([native]);
  entry.store.append('session', [load([native])]);
  expect(() => entry.store.append('session', [load([], [], 3)])).toThrow('silently remove');
});

it('rejects obsolete withdrawal fields', async () => {
  const entry = await fixture([native]);
  entry.store.append('session', [load([native])]);
  const obsolete = load([], [], 3);
  obsolete.data['removed'] = [native.definition.name];
  expect(() => entry.store.append('session', [obsolete])).toThrow();
});

it('replays consumed exact quotation metadata without looking up or recreating its historical source', async () => {
  const entry = await fixture();
  const quote = {
    source: {
      id: 'memory:historical-source',
      kind: 'memory' as const,
      contentHash: 'd'.repeat(64),
    },
    target: { kind: 'memory' as const, memoryId: 'historical-source' },
    start: 2,
    end: 8,
  };
  const message = {
    id: 'quoted-human',
    sessionId: 'session',
    branchId: 'main',
    runId: 'run',
    role: 'user',
    text: 'Exact quoted material already accepted',
    thinking: '',
    createdAt: 3,
    status: 'complete',
    stopReason: null,
  };
  entry.store.append('session', [
    event('message.started', message, {
      codecVersion: 1,
      sdkVersion: 'fixture',
      message: { role: 'user', content: message.text, timestamp: 3 },
      searchQuotes: [quote],
    }),
    event('run.finished', { status: 'completed', finishedAt: 4, error: null }),
  ]);
  entry.store.close();
  entry.store = await openProfileStore(entry.directory);
  expect(entry.store.getModelContext('session', 'main', [message.id])[0]?.['searchQuotes']).toEqual(
    [quote],
  );
  expect(entry.store.getSnapshot('session').messages[0]?.text).toBe(message.text);
});

it('does not let candidate metadata replace an initially declared schema', async () => {
  const replacement = structuredClone(native);
  replacement.definition.parameters = { type: 'object' };
  const entry = await fixture([replacement], [], [native]);
  expect(() => entry.store.append('session', [load([replacement])])).toThrow('not accepted');
});

it('loads a Skill only with the accepted content and plugin binding', async () => {
  const entry = await fixture([], [candidate(instructions)]);
  entry.store.append('session', [load([], [instructions])]);
  expect(entry.store.readEvents('session').at(-1)?.data).toMatchObject({
    skills: [instructions.selection],
  });
});

it('records a materialized directory for an accepted Skill and retains it after reopening', async () => {
  const entry = await fixture([], [], [], [instructions]);
  const materialized = { ...instructions, resourceDirectory: '/owned/resources/current' };
  entry.store.append('session', [load([], [materialized])]);
  entry.store.append('session', [load([], [materialized], 3)]);
  entry.store.close();
  entry.store = await openProfileStore(entry.directory);
  expect(
    entry.store.readEvents('session').filter((value) => value.type === 'run.tools_loaded'),
  ).toHaveLength(2);
});

it('rebinds a historical accepted directory on first load and permits a first directory on a later load', async () => {
  const historical = { ...instructions, resourceDirectory: '/owned/resources/old-run' };
  const entry = await fixture([], [], [], [historical]);
  entry.store.append('session', [
    load([], [{ ...historical, resourceDirectory: '/owned/resources/new-run' }]),
  ]);
  const delayed = await fixture([], [], [], [instructions]);
  delayed.store.append('session', [load([], [instructions])]);
  delayed.store.append('session', [
    load([], [{ ...instructions, resourceDirectory: '/owned/resources/late' }], 3),
  ]);
});

it.each(['directory', 'removed-directory', 'content', 'authorization', 'resources'])(
  'refuses a later Skill load that changes its recorded %s',
  async (change) => {
    const entry = await fixture([], [], [], [instructions]);
    const materialized = { ...instructions, resourceDirectory: '/owned/resources/current' };
    entry.store.append('session', [load([], [materialized])]);
    const altered: FrozenSkill = structuredClone(materialized);
    if (change === 'directory') altered.resourceDirectory = '/owned/resources/replacement';
    if (change === 'removed-directory') delete altered.resourceDirectory;
    if (change === 'content') altered.content = 'Changed instructions';
    if (change === 'authorization') altered.authorization.skillEpoch += 1;
    if (change === 'resources')
      altered.resources.push({
        path: 'changed.py',
        hash: 'e'.repeat(64),
        size: 1,
        mediaType: 'text/plain',
      });
    expect(() => entry.store.append('session', [load([], [altered], 3)])).toThrow(
      'instructions or authority',
    );
    expect(
      entry.store.readEvents('session').filter((value) => value.type === 'run.tools_loaded'),
    ).toHaveLength(1);
  },
);

it('freezes instructions and authorization while rebinding a historical accepted directory', async () => {
  const historical = { ...instructions, resourceDirectory: '/owned/resources/old-run' };
  const entry = await fixture([], [], [], [historical]);
  expect(() =>
    entry.store.append('session', [
      load(
        [],
        [{ ...historical, content: 'replacement', resourceDirectory: '/owned/resources/new-run' }],
      ),
    ]),
  ).toThrow('instructions or authority');
});

it('rejects duplicate active identities instead of choosing one Skill version', async () => {
  const entry = await fixture([], [candidate(instructions)]);
  expect(() => entry.store.append('session', [load([], [instructions, instructions])])).toThrow(
    expect.objectContaining({ code: 'INVALID_EVENT' }),
  );
});

it.each(['hash', 'generation', 'epoch', 'source', 'unknown'])(
  'rejects a Skill with changed %s even when the other metadata is unchanged',
  async (change) => {
    const entry = await fixture([], [candidate(instructions)]);
    const altered = structuredClone(instructions);
    if (change === 'hash') altered.selection.contentHash = 'c'.repeat(64);
    if (change === 'generation') altered.authorization.pluginGeneration = 'reinstalled';
    if (change === 'epoch') altered.authorization.skillEpoch += 1;
    if (change === 'source') altered.source = '/other/source';
    if (change === 'unknown') altered.selection.id = 'not-accepted';
    expect(() => entry.store.append('session', [load([], [altered])])).toThrow('not accepted');
  },
);

it('does not activate an explicit Skill while its accepted input remains queued', async () => {
  const entry = await fixture();
  entry.store.append('session', [queuedInput()]);
  expect(() => entry.store.append('session', [load([], [instructions])])).toThrow('not accepted');
  expect(entry.store.getSnapshot('session').queue).toHaveLength(1);
});

it('retains a consumed explicit Skill acceptance for the current Run', async () => {
  const entry = await fixture();
  entry.store.append('session', [queuedInput()]);
  entry.store.append('session', [
    event('queue.consumed', { inputId: 'queued' }),
    event('message.started', {
      id: 'user-message',
      sessionId: 'session',
      branchId: 'main',
      runId: 'run',
      role: 'user',
      text: '$github please review',
      thinking: '',
      createdAt: 4,
      status: 'complete',
      stopReason: null,
    }),
  ]);
  entry.store.append('session', [load([], [instructions])]);
  expect(entry.store.getSnapshot('session').queue).toEqual([]);
});

it('does not activate an unconsumed Skill after its queued input was deleted', async () => {
  const entry = await fixture();
  entry.store.append('session', [queuedInput(), event('queue.deleted', { inputId: 'queued' })]);
  expect(() => entry.store.append('session', [load([], [instructions])])).toThrow('not accepted');
});

it('does not retain a pending Skill removed by a queued input edit', async () => {
  const entry = await fixture();
  const input = queuedInput();
  entry.store.append('session', [input]);
  entry.store.append('session', [
    event(
      'queue.updated',
      { ...input.data, text: 'Ordinary follow-up', revision: 2, updatedAt: 4 },
      queueMetadata(),
    ),
  ]);
  expect(() => entry.store.append('session', [load([], [instructions])])).toThrow('not accepted');
});

it('does not use another Run pending input to authorize a new Skill', async () => {
  const entry = await fixture();
  entry.store.append('session', [
    queuedInput(),
    event('run.finished', { status: 'completed', finishedAt: 4, error: null }),
  ]);
  entry.store.append('session', [
    {
      ...event(
        'run.accepted',
        { run: { ...run, id: 'next-run', createdAt: 5 }, requestId: 'next-request' },
        {
          tools: [],
          toolSources: [],
          nativeCandidates: [],
          skillCandidates: [],
          skills: [],
        },
      ),
      runId: 'next-run',
    },
  ]);
  expect(() =>
    entry.store.append('session', [{ ...load([], [instructions]), runId: 'next-run' }]),
  ).toThrow('not accepted');
});
