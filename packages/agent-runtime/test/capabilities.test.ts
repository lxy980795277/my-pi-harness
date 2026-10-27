import { text as streamText } from 'node:stream/consumers';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { FrozenSkill, ToolSource } from '@my-pi-harness/protocol';
import type { SessionBatch } from '@my-pi-harness/storage';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import type { SkillsPort, ToolDiscoveryPort } from '../src/capabilities/ports.js';
import type { ExternalTools, FrozenMcpTool } from '../src/tools/external.js';
import type { RunToolDefinition } from '../src/tools/toolset.js';
import { call, fixture, gate, idle, observe, summary } from './support/work-fixture.js';

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
    freezeSelections: (_workspace, _approval, _mode, selected) =>
      Promise.resolve(selected.length ? [tool] : []),
    validateBindings: () => Promise.resolve(),
    assertBindingsCurrent: () => undefined,
    restoreBindings: (tools) => Promise.resolve(tools),
    call: invoke,
  };
  const discovery: ToolDiscoveryPort = { freezeCandidates: () => Promise.resolve([tool]) };
  return { tool, external, discovery, invoke };
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
    allowedTools: ['office_inspect'],
  };
  const current = (): void => {
    if (!enabled) throw new Error('Skill disabled');
  };
  const port: SkillsPort = {
    list: () => Promise.resolve([]),
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
  return context.messages.flatMap((message) =>
    message.role === 'system' ? (message.toolsAdded ?? []).map((tool) => tool.name) : [],
  );
}

describe('progressive Run capabilities through real Pi requests and SQLite/JSONL', () => {
  it.each([true, false])(
    'loads only declared local Office candidates alongside dynamic Skill instructions, workspace=%s',
    async (withWorkspace) => {
      const s = skills();
      const c = catalog();
      s.frozen.allowedTools = ['office_inspect', 'mcp_echo'];
      const f = await fixture(withWorkspace, {
        skills: s.port,
        discovery: c.discovery,
        externalTools: c.external,
      });
      let afterLoad: TranscriptContext | undefined;
      try {
        await writeFile(
          join(f.root, 'input.txt'),
          'This file deliberately has an unsupported Office extension.',
        );
        f.faux.setResponses([
          call('load_skill', s.frozen.selection),
          (context) => {
            afterLoad = context;
            return withWorkspace
              ? call('office_inspect', { source: 'input.txt' })
              : fauxAssistantMessage('No filesystem capability');
          },
          fauxAssistantMessage('Reported the inspection limit'),
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Use local Office instructions',
          mode: 'send',
          requestId: `dynamic-office-${String(withWorkspace)}`,
        });
        await idle(f);
        expect(names(afterLoad).includes('office_inspect')).toBe(withWorkspace);
        expect(names(afterLoad)).not.toContain('mcp_echo');
        if (withWorkspace) {
          const inspection = f.runtime
            .getSnapshot(f.session.id)
            .tools.find((tool) => tool.name === 'office_inspect');
          expect(inspection?.binding).toMatchObject({
            kind: 'accepted',
            source: { kind: 'workspace' },
          });
          expect(inspection?.result).toContain('Use a DOCX, PDF, XLSX or PPTX file');
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
      const view = {
        id: s.frozen.selection.id,
        name: s.frozen.name,
        description: s.frozen.description,
        contentHash: s.frozen.selection.contentHash,
        scope: s.frozen.scope,
        pluginId: null,
        workspaceId: null,
        enabled: true,
        shadowed: false,
        managed: true,
        resourceCount: 0,
        source: s.frozen.source,
      };
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
            return call('load_skill', s.frozen.selection);
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
        expect(first).toContain(s.frozen.selection.contentHash);
        expect(first).not.toContain('HIDDEN_DISABLED_SKILL');
        expect(first).not.toContain('HIDDEN_SHADOWED_SKILL');
        expect(first).not.toContain('FROZEN_SKILL_BODY');
        expect(JSON.stringify(contexts[1])).toContain('FROZEN_SKILL_BODY');
        const logged = await records(f);
        expect(logged.find(({ event }) => event.type === 'run.accepted')?.privateData).toContain(
          'availableSkills',
        );
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
      const audit = JSON.parse(accepted.privateData) as {
        tools: RunToolDefinition[];
        toolSources: { name: string; source: ToolSource; fingerprint: string }[];
      };
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
              privateData: JSON.stringify({ version: 1, ...next, skills: [] }),
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
  it('searches and automatically loads for the next request while keeping prior tool fingerprints stable', async () => {
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
      expect(contexts).toHaveLength(3);
      expect(names(contexts[0])).not.toContain('mcp_echo');
      expect(names(contexts[1])).toContain('mcp_echo');
      const logged = await records(f);
      const loaded = logged.find(({ event }) => event.type === 'run.tools_loaded');
      expect(loaded?.event.data).toMatchObject({ revision: 2 });
      const accepted = logged.find(({ event }) => event.type === 'run.accepted');
      if (!accepted?.privateData || !loaded?.privateData)
        throw new Error('Missing capability audit');
      const initial = JSON.parse(accepted.privateData) as {
        toolSources: { name: string; fingerprint: string }[];
      };
      const next = JSON.parse(loaded.privateData) as {
        tools: { definition: { name: string }; fingerprint: string }[];
      };
      for (const source of initial.toolSources)
        expect(next.tools.find((tool) => tool.definition.name === source.name)?.fingerprint).toBe(
          source.fingerprint,
        );
      expect(
        logged
          .filter(({ event }) => event.type === 'context.prepared')
          .map(({ event }) => event.data['capabilityRevision']),
      ).toEqual([1, 2, 2]);
      expect(f.runtime.getSnapshot(f.session.id).tools.map((tool) => tool.status)).toEqual([
        'completed',
        'completed',
      ]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each(['tool_search', 'load_tools'])(
    'cannot call a newly staged tool in the assistant that requested %s',
    async (loadTool) => {
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
                name: loadTool,
                arguments: loadTool === 'tool_search' ? { query: 'echo' } : { names: ['mcp_echo'] },
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
          f.runtime.getSnapshot(f.session.id).tools.find((tool) => tool.name === 'mcp_echo')
            ?.binding.kind,
        ).toBe('rejected');
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

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
          return call('load_tools', { names: ['mcp_echo'] });
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

  it('freezes Skill instructions and exposes only its declared native Office tools initially', async () => {
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
      expect(names(request)).toContain('office_inspect');
      expect(names(request)).not.toContain('office_docx');
      expect(JSON.stringify(request)).toContain('FROZEN_SKILL_BODY');
      s.frozen.content = 'MUTATED_CATALOG_BODY';
      const accepted = (await records(f)).find(({ event }) => event.type === 'run.accepted');
      expect(accepted?.privateData).toContain('FROZEN_SKILL_BODY');
      expect(accepted?.privateData).not.toContain('MUTATED_CATALOG_BODY');
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

  it('stops a revoked dynamic Skill load without committing visibility or freezing the Session', async () => {
    const s = skills();
    s.port.freezeSelections = () => {
      s.disable();
      return Promise.resolve([s.frozen]);
    };
    const f = await fixture(false, { skills: s.port });
    let requests = 0;
    try {
      f.faux.setResponses([
        () => {
          requests += 1;
          return call('load_skill', s.frozen.selection);
        },
        () => {
          requests += 1;
          return fauxAssistantMessage('Must not see a revoked Skill');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Load Skill',
        mode: 'send',
        requestId: 'dynamic-revoked',
      });
      await idle(f);
      expect(requests).toBe(1);
      expect(s.leases()).toBe(0);
      expect((await records(f)).some(({ event }) => event.type === 'run.tools_loaded')).toBe(false);
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('failed');
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
      f.faux.setResponses([
        (context) => {
          continuation = context;
          return fauxAssistantMessage('Continued the compacted task');
        },
      ]);
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

  it.each(['allow', 'deny'] as const)(
    'requires explicit Skill tool grant approval even in full access: %s',
    async (decision) => {
      const s = skills();
      const c = catalog();
      const f = await fixture(false, {
        skills: s.port,
        discovery: c.discovery,
        externalTools: c.external,
      });
      let next: TranscriptContext | undefined;
      try {
        await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
        f.faux.setResponses([
          call('request_skill_tools', { skillId: s.frozen.selection.id, names: ['mcp_echo'] }),
          (ctx) => {
            next = ctx;
            return fauxAssistantMessage('Grant observed');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Request tools',
          mode: 'send',
          requestId: decision,
          skills: [s.frozen.selection],
        });
        await observe(
          f.runtime,
          f.session.id,
          (snapshot) => snapshot.tools[0]?.status === 'awaiting_approval',
        );
        const tool = f.runtime.getSnapshot(f.session.id).tools[0];
        if (!tool || !f.tools) throw new Error('Missing approval');
        f.tools.decide(f.session.id, tool.id, { decision });
        await idle(f);
        expect(names(next).includes('mcp_echo')).toBe(decision === 'allow');
        const grants = (await records(f)).filter(
          ({ event }) => event.type === 'run.skill_tools_granted',
        );
        expect(grants).toHaveLength(decision === 'allow' ? 1 : 0);
        expect(c.invoke).not.toHaveBeenCalled();
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

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
      await f.runtime.send(f.session.id, {
        text: 'Queued under same Skill',
        mode: 'follow-up',
        requestId: 'queue',
        skills: [s.frozen.selection],
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
