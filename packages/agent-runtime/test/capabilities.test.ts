import { text as streamText } from 'node:stream/consumers';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fauxAssistantMessage,
  getCurrentTools,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import type { FrozenSkill, SkillCandidate, SkillView } from '@my-pi-harness/protocol';
import type { SessionBatch } from '@my-pi-harness/storage';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import type { SkillsPort, ToolDiscoveryPort } from '../src/capabilities/ports.js';
import type { ExternalTools, FrozenMcpTool } from '../src/tools/external.js';
import { call, fixture, gate, idle, summary } from './support/work-fixture.js';
import { acceptedTools, loadedTools } from './support/session-audit.js';

function catalog() {
  const tool: FrozenMcpTool = {
    selection: {
      serverId: 'remote',
      serverRevision: 1,
      remoteToolName: 'echo',
      definitionFingerprint: 'a'.repeat(64),
    },
    definition: {
      name: 'mcp_echo',
      description: 'Echo catalog evidence',
      parameters: Type.Object({ text: Type.String() }, { additionalProperties: false }),
    },
    authorization: {
      ownerId: 'owner',
      identityEpoch: 1,
      accessEpoch: 1,
      credentialEpoch: 1,
      grantId: 'grant',
      workspaceId: '',
      workspaceRoot: 'https://fixture.invalid',
      scope: 'full-access',
      startupFingerprint: 'b'.repeat(64),
    },
  };
  const invoke = vi.fn<ExternalTools['call']>(async (input) => {
    await input.beforeDispatch();
    return {
      kind: 'known',
      isError: false,
      content: [{ type: 'text', text: String(input.arguments['text']) }],
      summary: 'Echo evidence',
    };
  });
  const external: ExternalTools = {
    freezeSelections: (_workspace, _approval, selected) =>
      Promise.resolve(selected.length ? [tool] : []),
    validateBindings: () => Promise.resolve(),
    assertBindingsCurrent: () => undefined,
    restoreBindings: (tools) => Promise.resolve(tools),
    call: invoke,
  };
  const discovery: ToolDiscoveryPort = { freezeCandidates: () => Promise.resolve([tool]) };
  return { tool, external, discovery, invoke };
}

function skillCandidate(skill: FrozenSkill): SkillCandidate {
  const { selection, authorization, name, description, scope, source } = skill;
  return { selection, authorization, name, description, scope, source };
}

function skillView(skill: FrozenSkill): SkillView {
  return {
    id: skill.selection.id,
    name: skill.name,
    description: skill.description,
    contentHash: skill.selection.contentHash,
    scope: skill.scope,
    pluginId: skill.authorization.pluginId,
    workspaceId: null,
    enabled: true,
    shadowed: false,
    managed: true,
    resourceCount: skill.resources.length,
    source: skill.source,
  };
}

function skills() {
  let enabled = true;
  let leases = 0;
  const frozen: FrozenSkill = {
    selection: { id: 'skill:test', contentHash: 'c'.repeat(64) },
    authorization: { skillEpoch: 1, pluginId: null, pluginEpoch: 0, pluginGeneration: null },
    name: 'Test instructions',
    description: 'A frozen test Skill',
    scope: 'user',
    source: '/registered/test',
    content: 'FROZEN_SKILL_BODY: inspect the result before reporting completion.',
    resources: [],
    allowedTools: ['read_document'],
  };
  const current = (): void => {
    if (!enabled) throw new Error('Skill disabled');
  };
  const port: SkillsPort = {
    list: () => Promise.resolve([]),
    freezeCandidates: () => Promise.resolve(enabled ? [skillCandidate(frozen)] : []),
    loadCandidate: () => {
      current();
      return Promise.resolve(frozen);
    },
    freezeSelections: (_workspace, selected) => {
      current();
      return Promise.resolve(selected.length ? [frozen] : []);
    },
    validateBindings: (bindings) => {
      if (bindings.length > 0) current();
      return Promise.resolve();
    },
    assertBindingsCurrent: (bindings) => {
      if (bindings.length > 0) current();
    },
    retainBindings: () => {
      leases += 1;
      return () => {
        leases -= 1;
      };
    },
    loadResource: () => Promise.resolve([{ type: 'text', text: 'Frozen resource evidence' }]),
  };
  return {
    frozen,
    port,
    disable: (): void => {
      enabled = false;
    },
    leases: () => leases,
  };
}

async function records(f: Awaited<ReturnType<typeof fixture>>) {
  return (await streamText(f.store.exportSessionLog(f.session.id).content))
    .trim()
    .split('\n')
    .flatMap((line) => (JSON.parse(line) as SessionBatch).records);
}
function names(context: TranscriptContext | undefined): string[] {
  if (!context) throw new Error('Missing actual model request');
  return getCurrentTools(context.messages).map((tool) => tool.name);
}

describe('progressive Run capabilities through real Pi requests and SQLite/JSONL', () => {
  it('discovers and executes session history without an MCP service or a workspace', async () => {
    const f = await fixture(false);
    let initial: TranscriptContext | undefined;
    let loaded: TranscriptContext | undefined;
    try {
      f.faux.setResponses([
        (context) => {
          initial = context;
          return call('tool_search', { query: 'search_session_history', limit: 1 });
        },
        (context) => {
          loaded = context;
          return call('search_session_history', { query: 'HISTORY_WITNESS' });
        },
        fauxAssistantMessage('Read the original session evidence'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'HISTORY_WITNESS: locate this original statement',
        mode: 'send',
        requestId: 'native-history-discovery',
      });
      await idle(f);
      expect(names(initial)).not.toContain('search_session_history');
      expect(names(loaded)).toContain('search_session_history');
      const result = f.runtime
        .getSnapshot(f.session.id)
        .tools.find((tool) => tool.name === 'search_session_history');
      expect(result?.binding).toMatchObject({ kind: 'accepted', source: { kind: 'session' } });
      expect(result?.result).toContain('HISTORY_WITNESS');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('reads a newly installed Skill resource after an explicit invocation during a Run that began without Skills', async () => {
    const s = skills();
    s.frozen.name = 'late-skill';
    s.frozen.resources = [
      { path: 'evidence.txt', hash: 'd'.repeat(64), size: 1, mediaType: 'text/plain' },
    ];
    s.port.freezeCandidates = () => Promise.resolve([]);
    const f = await fixture(false, { skills: s.port });
    const entered = gate();
    const finish = gate();
    let initial: TranscriptContext | undefined;
    let afterInvocation: TranscriptContext | undefined;
    try {
      f.faux.setResponses([
        async (context) => {
          initial = context;
          entered.release();
          await finish.promise;
          return fauxAssistantMessage('Initial work');
        },
        (context) => {
          afterInvocation = context;
          return call('read_skill_resource', {
            skillId: s.frozen.selection.id,
            path: 'evidence.txt',
          });
        },
        fauxAssistantMessage('Read the supporting evidence'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Begin ordinary work',
        mode: 'send',
        requestId: 'before-skill-installation',
      });
      await entered.promise;
      s.port.list = () => Promise.resolve([skillView(s.frozen)]);
      await f.runtime.send(f.session.id, {
        text: '$late-skill Read its supporting resource',
        mode: 'steer',
        requestId: 'after-skill-installation',
      });
      finish.release();
      await idle(f);
      expect(names(initial)).not.toContain('load_skill');
      expect(names(initial)).not.toContain('read_skill_resource');
      expect(names(afterInvocation)).toContain('read_skill_resource');
      expect(JSON.stringify(afterInvocation)).toContain('FROZEN_SKILL_BODY');
      expect(
        f.runtime
          .getSnapshot(f.session.id)
          .tools.find((tool) => tool.name === 'read_skill_resource'),
      ).toMatchObject({ status: 'completed', result: 'Frozen resource evidence' });
      expect(s.leases()).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      finish.release();
      await f.close();
    }
  });

  it.each(['delete', 'edit'] as const)(
    'does not activate a pending explicit Skill after the user chooses to %s its queued invocation',
    async (operation) => {
      const s = skills();
      s.frozen.name = 'late-skill';
      s.port.freezeCandidates = () => Promise.resolve([]);
      const f = await fixture(false, { skills: s.port });
      const entered = gate();
      const finish = gate();
      let continuation: TranscriptContext | undefined;
      try {
        f.faux.setResponses([
          async () => {
            entered.release();
            await finish.promise;
            return call('tool_search', { query: 'ask_user', limit: 1 });
          },
          (context) => {
            continuation = context;
            return fauxAssistantMessage('Continued without the removed instructions');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Ordinary work',
          mode: 'send',
          requestId: `pending-skill-${operation}`,
        });
        await entered.promise;
        s.port.list = () => Promise.resolve([skillView(s.frozen)]);
        const input = await f.runtime.send(f.session.id, {
          text: '$late-skill Apply these instructions',
          mode: 'steer',
          requestId: `queued-skill-${operation}`,
        });
        if (!input.inputId) throw new Error('Missing queued invocation');
        if (operation === 'delete') await f.runtime.deleteQueue(f.session.id, input.inputId);
        else
          await f.runtime.updateQueue(f.session.id, input.inputId, {
            revision: 1,
            text: 'Continue ordinary work',
          });
        finish.release();
        await idle(f);
        expect(continuation).toBeDefined();
        expect(JSON.stringify(continuation)).not.toContain('FROZEN_SKILL_BODY');
        for (const record of (await records(f)).filter(
          ({ event }) => event.type === 'run.tools_loaded',
        ))
          expect(record.event.data).toMatchObject({ skills: [] });
        expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
        expect(s.leases()).toBe(0);
        expect(f.errors).toEqual([]);
      } finally {
        finish.release();
        await f.close();
      }
    },
  );

  it.each([true, false])(
    'loads only declared document readers alongside dynamic Skill instructions, workspace=%s',
    async (withWorkspace) => {
      const s = skills();
      const c = catalog();
      s.frozen.allowedTools = ['read_document', 'mcp_echo'];
      const f = await fixture(withWorkspace, {
        skills: s.port,
        discovery: c.discovery,
        externalTools: c.external,
      });
      let afterLoad: TranscriptContext | undefined;
      try {
        await writeFile(
          join(f.root, 'input.txt'),
          'This file deliberately has an unsupported document extension.',
        );
        f.faux.setResponses([
          call('load_skill', { id: s.frozen.selection.id }),
          (context) => {
            afterLoad = context;
            return withWorkspace
              ? call('read_document', { path: 'input.txt' })
              : fauxAssistantMessage('No filesystem capability');
          },
          fauxAssistantMessage('Reported the inspection limit'),
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Use local document instructions',
          mode: 'send',
          requestId: `dynamic-document-${String(withWorkspace)}`,
        });
        await idle(f);
        expect(names(afterLoad).includes('read_document')).toBe(withWorkspace);
        expect(names(afterLoad)).not.toContain('mcp_echo');
        if (withWorkspace) {
          const inspection = f.runtime
            .getSnapshot(f.session.id)
            .tools.find((tool) => tool.name === 'read_document');
          expect(inspection?.binding).toMatchObject({
            kind: 'accepted',
            source: { kind: 'workspace' },
          });
          expect(inspection?.result).toContain('Use a PDF, Office, OpenDocument or EPUB document');
        }
        expect(c.invoke).not.toHaveBeenCalled();
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );
  it.each([true, false])(
    'lists enabled Skill summaries before selection and loads their frozen instructions on the next actual request, context=%s',
    async (withContext) => {
      const s = skills();
      const view = skillView(s.frozen);
      s.port.list = () =>
        Promise.resolve([
          view,
          { ...view, id: 'skill:disabled', name: 'HIDDEN_DISABLED_SKILL', enabled: false },
          { ...view, id: 'skill:shadowed', name: 'HIDDEN_SHADOWED_SKILL', shadowed: true },
        ]);
      const f = await fixture(false, { skills: s.port, context: withContext });
      const contexts: TranscriptContext[] = [];
      try {
        f.faux.setResponses([
          (context) => {
            contexts.push(context);
            return call('load_skill', { id: s.frozen.selection.id });
          },
          (context) => {
            contexts.push(context);
            return fauxAssistantMessage('Instructions are now active');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Use the test instructions',
          mode: 'send',
          requestId: `skill-discovery-${String(withContext)}`,
        });
        await idle(f);
        const first = JSON.stringify(contexts[0]);
        expect(first).toContain('availableSkills');
        expect(first).toContain(s.frozen.selection.id);
        expect(first).not.toContain(s.frozen.selection.contentHash);
        expect(first).not.toContain('HIDDEN_DISABLED_SKILL');
        expect(first).not.toContain('HIDDEN_SHADOWED_SKILL');
        expect(first).not.toContain('FROZEN_SKILL_BODY');
        expect(JSON.stringify(contexts[1])).toContain('FROZEN_SKILL_BODY');
        const logged = await records(f);
        expect(
          JSON.stringify(logged.find(({ event }) => event.type === 'run.accepted')?.privateData),
        ).toContain('availableSkills');
        expect(logged.filter(({ event }) => event.type === 'run.tools_loaded')).toHaveLength(1);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('rejects skipped revisions, replaced schemas, native sources and removed initial tools before journal writes', async () => {
    const c = catalog();
    const f = await fixture(false, { externalTools: c.external, discovery: c.discovery });
    const entered = gate();
    const finish = gate();
    try {
      f.faux.setResponses([
        async () => {
          entered.release();
          await finish.promise;
          return fauxAssistantMessage('Finished');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Keep a live Run',
        mode: 'send',
        requestId: 'validate-load',
      });
      await entered.promise;
      const snapshot = f.runtime.getSnapshot(f.session.id);
      const accepted = (await records(f)).find(({ event }) => event.type === 'run.accepted');
      if (!accepted?.privateData) throw new Error('Missing accepted tool audit');
      const audit = acceptedTools(accepted.privateData);
      const initial = audit.tools.map((definition) => {
        const identity = audit.toolSources.find((source) => source.name === definition.name);
        if (!identity) throw new Error('Missing source');
        return { definition, source: identity.source, fingerprint: identity.fingerprint };
      });
      const first = initial[0];
      if (!first) throw new Error('Missing controller tools');
      const cases = [
        { revision: 3, tools: initial },
        { revision: 2, tools: [] },
        { revision: 2, tools: [{ ...first, source: { kind: 'workspace' } }, ...initial.slice(1)] },
        {
          revision: 2,
          tools: [
            {
              ...first,
              source: {
                kind: 'connection',
                connectionId: 'account',
                grantId: 'grant',
                operation: 'read',
              },
            },
            ...initial.slice(1),
          ],
        },
        {
          revision: 2,
          tools: [
            ...initial,
            {
              definition: { ...c.tool.definition, description: 'Replaced schema' },
              source: {
                kind: 'mcp',
                serverId: 'remote',
                serverRevision: 1,
                remoteToolName: 'echo',
              },
              fingerprint: c.tool.selection.definitionFingerprint,
              external: c.tool,
            },
          ],
        },
      ];
      cases.push({
        revision: 2,
        tools: [
          ...initial,
          {
            definition: c.tool.definition,
            source: { kind: 'mcp', serverId: 'remote', serverRevision: 1, remoteToolName: 'echo' },
            fingerprint: c.tool.selection.definitionFingerprint,
            external: {
              ...c.tool,
              authorization: {
                ...c.tool.authorization,
                grantId: 'replaced-grant',
                workspaceRoot: '/different-workspace',
              },
            },
          },
        ],
      });
      for (const next of cases)
        expect(() =>
          f.store.append(f.session.id, [
            {
              type: 'run.tools_loaded',
              runId: snapshot.session.activeRunId,
              at: Date.now(),
              data: {
                revision: next.revision,
                names: next.tools.map((tool) => tool.definition.name),
                skills: [],
              },
              privateData: { version: 1, ...next, skills: [] },
            },
          ]),
        ).toThrow();
      expect((await records(f)).some(({ event }) => event.type === 'run.tools_loaded')).toBe(false);
      finish.release();
      await idle(f);
      expect(f.errors).toEqual([]);
    } finally {
      finish.release();
      await f.close();
    }
  });
  it('loads for the next request, keeps repeat searches stable and rebuilds the next Run without old MCP declarations', async () => {
    const c = catalog();
    const diagnostics = vi.fn<NonNullable<ToolDiscoveryPort['diagnostics']>>(() => []);
    c.discovery.diagnostics = diagnostics;
    const f = await fixture(false, { externalTools: c.external, discovery: c.discovery });
    const contexts: TranscriptContext[] = [];
    try {
      await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
      f.faux.setResponses([
        (ctx) => {
          contexts.push(ctx);
          return call('tool_search', { query: 'evidence' });
        },
        (ctx) => {
          contexts.push(ctx);
          return call('tool_search', { query: 'evidence' });
        },
        (ctx) => {
          contexts.push(ctx);
          return call('mcp_echo', { text: 'DYNAMIC_RESULT' });
        },
        (ctx) => {
          contexts.push(ctx);
          return fauxAssistantMessage('Observed dynamic result');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Find and use echo',
        mode: 'send',
        requestId: 'load',
      });
      await idle(f);
      expect(diagnostics).toHaveBeenCalledWith(null, 'full-access');
      expect(c.invoke).toHaveBeenCalledTimes(1);
      expect(contexts).toHaveLength(4);
      expect(names(contexts[0])).not.toContain('mcp_echo');
      expect(names(contexts[1])).toContain('mcp_echo');
      const logged = await records(f);
      const loaded = logged.find(({ event }) => event.type === 'run.tools_loaded');
      expect(logged.filter(({ event }) => event.type === 'run.tools_loaded')).toHaveLength(1);
      expect(loaded?.event.data).toMatchObject({ revision: 2 });
      const accepted = logged.find(({ event }) => event.type === 'run.accepted');
      if (!accepted?.privateData || !loaded?.privateData)
        throw new Error('Missing capability audit');
      const initial = acceptedTools(accepted.privateData);
      const next = loadedTools(loaded.privateData);
      for (const source of initial.toolSources)
        expect(next.tools.find((tool) => tool.definition.name === source.name)?.fingerprint).toBe(
          source.fingerprint,
        );
      expect(
        logged
          .filter(({ event }) => event.type === 'context.prepared')
          .map(({ event }) => event.data['capabilityRevision']),
      ).toEqual([1, 2, 2, 2]);
      expect(f.runtime.getSnapshot(f.session.id).tools.map((tool) => tool.status)).toEqual([
        'completed',
        'completed',
        'completed',
      ]);
      expect(f.errors).toEqual([]);
      let nextRun: TranscriptContext | undefined;
      f.faux.setResponses([
        (context) => {
          nextRun = context;
          return fauxAssistantMessage('A new task starts with a fresh tool selection');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Begin another task',
        mode: 'send',
        requestId: 'fresh-tool-selection',
      });
      await idle(f);
      expect(names(nextRun)).not.toContain('mcp_echo');
      expect(c.invoke).toHaveBeenCalledOnce();
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('cannot call a newly staged tool in the assistant that searched for it', async () => {
    const c = catalog();
    const f = await fixture(false, { externalTools: c.external, discovery: c.discovery });
    try {
      await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
      f.faux.setResponses([
        fauxAssistantMessage(
          [
            {
              type: 'toolCall',
              id: 'load',
              name: 'tool_search',
              arguments: { query: 'echo' },
            },
            {
              type: 'toolCall',
              id: 'early',
              name: 'mcp_echo',
              arguments: { text: 'not offered yet' },
            },
          ],
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('Wait for the new declaration'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Stage a tool',
        mode: 'send',
        requestId: 'early',
      });
      await idle(f);
      expect(c.invoke).not.toHaveBeenCalled();
      expect(
        f.runtime.getSnapshot(f.session.id).tools.find((tool) => tool.name === 'mcp_echo')?.binding
          .kind,
      ).toBe('rejected');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('stops before the next model request if its tool visibility audit cannot be committed', async () => {
    const c = catalog();
    const f = await fixture(false, { externalTools: c.external, discovery: c.discovery });
    let requests = 0;
    try {
      const append = f.store.append.bind(f.store);
      vi.spyOn(f.store, 'append').mockImplementation((id, events) => {
        if (events.some((event) => event.type === 'run.tools_loaded'))
          throw new Error('Visibility fsync failed');
        return append(id, events);
      });
      f.faux.setResponses([
        () => {
          requests += 1;
          return call('tool_search', { query: 'mcp_echo' });
        },
        () => {
          requests += 1;
          return fauxAssistantMessage('Must not run');
        },
      ]);
      await f.runtime.send(f.session.id, { text: 'Load', mode: 'send', requestId: 'fail-load' });
      await vi.waitFor(() => expect(f.errors.length).toBeGreaterThan(0));
      await f.runtime.close();
      expect(requests).toBe(1);
      expect(c.invoke).not.toHaveBeenCalled();
      expect(() => f.runtime.getSnapshot(f.session.id)).toThrow(
        expect.objectContaining({ code: 'SESSION_UNAVAILABLE' }),
      );
    } finally {
      await f.close();
    }
  });

  it('freezes Skill instructions and exposes only its declared document readers initially', async () => {
    const s = skills();
    const c = catalog();
    const f = await fixture(true, {
      skills: s.port,
      discovery: c.discovery,
      externalTools: c.external,
    });
    const entered = gate();
    const finish = gate();
    let request: TranscriptContext | undefined;
    try {
      f.faux.setResponses([
        async (ctx) => {
          request = ctx;
          entered.release();
          await finish.promise;
          return fauxAssistantMessage('Skill applied');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Apply Skill',
        mode: 'send',
        requestId: 'skill',
        skills: [s.frozen.selection],
      });
      await entered.promise;
      expect(s.leases()).toBe(1);
      expect(names(request)).toContain('read_document');
      expect(names(request)).not.toContain('view_pdf_page');
      expect(JSON.stringify(request)).toContain('FROZEN_SKILL_BODY');
      s.frozen.content = 'MUTATED_CATALOG_BODY';
      const accepted = (await records(f)).find(({ event }) => event.type === 'run.accepted');
      expect(JSON.stringify(accepted?.privateData)).toContain('FROZEN_SKILL_BODY');
      expect(JSON.stringify(accepted?.privateData)).not.toContain('MUTATED_CATALOG_BODY');
      finish.release();
      await idle(f);
      expect(s.leases()).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      finish.release();
      await f.close();
    }
  });

  it('rechecks Skill authority after asynchronous external validation before dispatching a model request', async () => {
    const s = skills();
    const c = catalog();
    const validating = gate();
    const release = gate();
    c.external.validateBindings = async () => {
      validating.release();
      await release.promise;
    };
    const f = await fixture(false, {
      skills: s.port,
      externalTools: c.external,
      discovery: c.discovery,
    });
    let requests = 0;
    try {
      f.faux.setResponses([
        () => {
          requests += 1;
          return fauxAssistantMessage('Must not receive revoked instructions');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Freeze before dispatch',
        mode: 'send',
        requestId: 'dispatch-revoke',
        skills: [s.frozen.selection],
        mcpTools: [c.tool.selection],
      });
      await validating.promise;
      s.disable();
      release.release();
      await idle(f);
      expect(requests).toBe(0);
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('failed');
    } finally {
      release.release();
      await f.close();
    }
  });

  it('rejects a revoked dynamic Skill before staging and lets the Session continue without its instructions', async () => {
    const s = skills();
    s.port.loadCandidate = () => {
      s.disable();
      return Promise.resolve(s.frozen);
    };
    const f = await fixture(false, { skills: s.port });
    let requests = 0;
    let next: TranscriptContext | undefined;
    try {
      f.faux.setResponses([
        () => {
          requests += 1;
          return call('load_skill', { id: s.frozen.selection.id });
        },
        (context) => {
          requests += 1;
          next = context;
          return fauxAssistantMessage('The unavailable instructions were not loaded');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Load Skill',
        mode: 'send',
        requestId: 'dynamic-revoked',
      });
      await idle(f);
      expect(requests).toBe(2);
      expect(next).toBeDefined();
      expect(JSON.stringify(next)).not.toContain('FROZEN_SKILL_BODY');
      expect(s.leases()).toBe(0);
      expect((await records(f)).some(({ event }) => event.type === 'run.tools_loaded')).toBe(false);
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.status).toBe('failed');
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
      expect(f.errors).toEqual([]);
      f.faux.setResponses([fauxAssistantMessage('Session still works')]);
      await f.runtime.send(f.session.id, {
        text: 'Continue without Skill',
        mode: 'send',
        requestId: 'after-revoke',
        skills: [],
      });
      await idle(f);
      expect(f.runtime.getSnapshot(f.session.id).runs.at(-1)?.status).toBe('completed');
    } finally {
      await f.close();
    }
  });

  it('keeps frozen Skill instructions in every real model request after automatic compaction', async () => {
    const s = skills();
    s.frozen.resources = [
      { path: 'evidence.txt', hash: 'd'.repeat(64), size: 1, mediaType: 'text/plain' },
    ];
    s.port.loadResource = () =>
      Promise.resolve([
        {
          type: 'text',
          text: 'RESOURCE_SOURCE_EVIDENCE with enough retained detail.\n'.repeat(1000),
        },
      ]);
    const f = await fixture(false, { skills: s.port });
    let requests = 0;
    let compactions = 0;
    try {
      f.faux.models[0].contextWindow = 12_000;
      f.faux.models[0].maxTokens = 512;
      const response = (context: TranscriptContext) => {
        const prompt = context.messages
          .filter((message) => message.role === 'system')
          .map((message) => JSON.stringify(message.content))
          .join('\n');
        if (prompt.includes('Produce a JSON object with exactly objective')) {
          compactions += 1;
          return fauxAssistantMessage(summary('Continue the Skill resource task'));
        }
        requests += 1;
        expect(prompt).toContain('FROZEN_SKILL_BODY');
        expect(prompt).not.toContain('MUTATED_DURING_RUN');
        if (requests === 1) s.frozen.content = 'MUTATED_DURING_RUN';
        if (requests <= 16)
          return call(
            'read_skill_resource',
            { skillId: s.frozen.selection.id, path: 'evidence.txt' },
            `resource-${requests}`,
          );
        return fauxAssistantMessage('Observed frozen instructions after compaction');
      };
      f.faux.setResponses(Array.from({ length: 80 }, () => response));
      await f.runtime.send(f.session.id, {
        text: 'Read and retain source evidence',
        mode: 'send',
        requestId: 'skill-compaction',
        skills: [s.frozen.selection],
      });
      await idle(f);
      expect(f.errors).toEqual([]);
      expect(requests).toBe(17);
      expect(compactions).toBeGreaterThan(0);
      expect(f.work.snapshot(f.session.id).state.compaction).not.toBeNull();
      let continuation: TranscriptContext | undefined;
      f.faux.setResponses(
        Array.from({ length: 8 }, () => (context: TranscriptContext) => {
          if (
            JSON.stringify(context.messages[0]).includes(
              'Produce a JSON object with exactly objective',
            )
          )
            return fauxAssistantMessage(summary('Continue the Skill resource task'));
          continuation = context;
          return fauxAssistantMessage('Continued the compacted task');
        }),
      );
      await f.runtime.send(f.session.id, {
        text: 'Continue after compaction',
        mode: 'send',
        requestId: 'skill-compaction-next-run',
      });
      await idle(f);
      expect(JSON.stringify(continuation)).toContain('FROZEN_SKILL_BODY');
      expect(JSON.stringify(continuation)).not.toContain('MUTATED_DURING_RUN');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  }, 15000);

  it('uses discovered MCP tools under the normal full-access policy without a separate Skill grant', async () => {
    const s = skills();
    const c = catalog();
    const f = await fixture(false, {
      skills: s.port,
      discovery: c.discovery,
      externalTools: c.external,
    });
    let first: TranscriptContext | undefined;
    try {
      await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
      f.faux.setResponses([
        (context) => {
          first = context;
          return call('tool_search', { query: 'mcp_echo' });
        },
        call('mcp_echo', { text: 'Used the configured execution policy' }),
        fauxAssistantMessage('Observed the result'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Use the service with this Skill',
        mode: 'send',
        requestId: 'skill-normal-policy',
        skills: [s.frozen.selection],
      });
      await idle(f);
      expect(names(first)).not.toContain('request_skill_tools');
      expect(names(first)).not.toContain('revoke_skill_tools');
      expect(c.invoke).toHaveBeenCalledOnce();
      expect(f.runtime.getSnapshot(f.session.id).tools.map((tool) => tool.status)).toEqual([
        'completed',
        'completed',
      ]);
      expect(
        (await records(f)).some(({ event }) => event.type.startsWith('run.skill_tools_')),
      ).toBe(false);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('retains queued input when Skill authorization is revoked before the next request', async () => {
    const s = skills();
    const f = await fixture(false, { skills: s.port });
    const entered = gate();
    const finish = gate();
    try {
      f.faux.setResponses([
        async () => {
          entered.release();
          await finish.promise;
          return fauxAssistantMessage('First response');
        },
        fauxAssistantMessage('Must not consume revoked input'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Start',
        mode: 'send',
        requestId: 'start',
        skills: [s.frozen.selection],
      });
      await entered.promise;
      const queued = await f.runtime.send(f.session.id, {
        text: 'Queued under same Skill',
        mode: 'follow-up',
        requestId: 'queue',
        skills: [s.frozen.selection],
      });
      if (!queued.inputId) throw new Error('Missing queued input identity');
      const metadata = f.store.getQueuePrivateData(f.session.id, queued.inputId);
      expect(metadata).toMatchObject({
        requestId: 'queue',
        mcpBindings: [],
        candidateBindings: [],
        skillBindings: [s.frozen],
        discoveryDiagnostics: [],
        mentionedSkillBindings: [],
        inheritedSkillBindings: [],
      });
      s.disable();
      finish.release();
      await idle(f);
      expect(f.runtime.getSnapshot(f.session.id).queue).toHaveLength(1);
      expect(
        f.runtime.getSnapshot(f.session.id).messages.filter((message) => message.role === 'user'),
      ).toHaveLength(1);
      expect(s.leases()).toBe(0);
    } finally {
      finish.release();
      await f.close();
    }
  });
});
