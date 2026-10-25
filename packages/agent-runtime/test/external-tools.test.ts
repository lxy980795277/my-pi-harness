import { text as streamText } from 'node:stream/consumers';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { McpToolSelection } from '@my-pi-harness/protocol';
import type { SessionBatch } from '@my-pi-harness/storage';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import type { ExternalToolCall, ExternalTools, FrozenMcpTool } from '../src/external-tools.js';
import { decodeContextMessage } from '../src/context-codec.js';
import { fallbackSummary, summaryRecord } from '../src/context/summary.js';
import { fixture, gate, idle, observe } from './support/work-fixture.js';

const selection: McpToolSelection = {
  serverId: 'server',
  serverRevision: 1,
  remoteToolName: 'echo',
  definitionFingerprint: 'a'.repeat(64),
};

function external() {
  let root = '';
  let revoked = false;
  const frozen = (): FrozenMcpTool => ({
    selection,
    definition: {
      name: 'mcp_echo',
      description: 'Echo an observed input',
      parameters: Type.Object({ text: Type.String() }, { additionalProperties: false }),
    },
    authorization: {
      ownerId: 'owner',
      identityEpoch: 1,
      accessEpoch: 1,
      credentialEpoch: 1,
      grantId: 'grant',
      workspaceId: 'workspace',
      workspaceRoot: root,
      scope: 'full-access',
      startupFingerprint: 'b'.repeat(64),
    },
  });
  const validate = (): void => {
    if (revoked) throw new Error('Grant revoked');
  };
  const call = vi.fn<ExternalTools['call']>(async (input: ExternalToolCall) => {
    await input.beforeDispatch();
    return {
      kind: 'known' as const,
      isError: false,
      content: [{ type: 'text' as const, text: String(input.arguments['text']) }],
      summary: 'Echo returned',
    };
  });
  const port: ExternalTools = {
    freezeSelections: () => {
      validate();
      return Promise.resolve([frozen()]);
    },
    validateBindings: () => {
      validate();
      return Promise.resolve();
    },
    assertBindingsCurrent: validate,
    restoreBindings: (tools) => {
      validate();
      return Promise.resolve(tools.map((tool) => ({ ...tool, definition: frozen().definition })));
    },
    call,
  };
  return {
    port,
    call,
    root: (path: string): void => {
      root = path;
    },
    revoke: (): void => {
      revoked = true;
    },
  };
}

async function setup() {
  const bridge = external();
  const f = await fixture(true, { externalTools: bridge.port });
  bridge.root(f.root);
  await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
  return { f, bridge };
}

async function batches(f: Awaited<ReturnType<typeof fixture>>): Promise<SessionBatch[]> {
  return (await streamText(f.store.exportSessionLog(f.session.id).content))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as SessionBatch);
}

describe('external tool outcomes through the actual Pi loop and durable journal', () => {
  it('requires the independent tool approval and records denial without starting a call', async () => {
    const { f, bridge } = await setup();
    try {
      await f.runtime.updateSession(f.session.id, { approvalMode: 'ask' });
      f.faux.setResponses([
        fauxAssistantMessage(
          [{ type: 'toolCall', id: 'denied', name: 'mcp_echo', arguments: { text: 'input' } }],
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('The user denied this operation'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Ask before the call',
        mode: 'send',
        requestId: 'deny',
        mcpTools: [selection],
      });
      await observe(
        f.runtime,
        f.session.id,
        (snapshot) => snapshot.tools[0]?.status === 'awaiting_approval',
      );
      const tool = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!tool || !f.tools) throw new Error('Missing approval');
      expect(bridge.call).not.toHaveBeenCalled();
      f.tools.decide(f.session.id, tool.id, { decision: 'deny' });
      await idle(f);
      expect(bridge.call).not.toHaveBeenCalled();
      expect(f.runtime.getSnapshot(f.session.id).tools[0]).toMatchObject({
        status: 'denied',
        dispatch: { state: 'not_started' },
      });
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('records the dispatch barrier before the single call and commits the terminal result with its canonical context', async () => {
    const { f, bridge } = await setup();
    const contexts: TranscriptContext[] = [];
    try {
      bridge.call.mockImplementation(async (input) => {
        expect(f.runtime.getSnapshot(f.session.id).tools[0]?.dispatch.state).toBe('not_started');
        await input.beforeDispatch();
        expect(f.runtime.getSnapshot(f.session.id).tools[0]?.dispatch).toMatchObject({
          state: 'may_have_started',
          attemptId: input.callAttemptId,
        });
        return {
          kind: 'known',
          isError: false,
          content: [{ type: 'text', text: 'Observed echo' }],
          summary: 'Echo returned',
        };
      });
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage(
            [{ type: 'toolCall', id: 'echo', name: 'mcp_echo', arguments: { text: 'input' } }],
            { stopReason: 'toolUse' },
          );
        },
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('Observed echo received');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Echo input',
        mode: 'send',
        requestId: 'echo',
        mcpTools: [selection],
      });
      await idle(f);
      expect(bridge.call).toHaveBeenCalledTimes(1);
      expect(contexts).toHaveLength(2);
      expect(contexts[1]?.messages).toContainEqual(
        expect.objectContaining({
          role: 'toolResult',
          content: [{ type: 'text', text: 'Observed echo' }],
        }),
      );
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.runs[0]?.status).toBe('completed');
      expect(snapshot.tools[0]).toMatchObject({
        status: 'completed',
        binding: {
          kind: 'accepted',
          source: { kind: 'mcp', serverId: 'server', remoteToolName: 'echo' },
        },
      });
      const terminal = (await batches(f)).find((batch) =>
        batch.records.some(({ event }) => event.type === 'tool.context'),
      );
      expect(terminal?.records.map(({ event }) => event.type)).toEqual([
        'tool.updated',
        'tool.context',
      ]);
      const encoded = terminal?.records.find(
        ({ event }) => event.type === 'tool.context',
      )?.privateData;
      expect(encoded && JSON.parse(encoded)).toMatchObject({
        origin: 'server',
        outcome: 'completed',
        providerCallId: 'echo',
      });
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each([false, true])(
    'projects tool images for model image capability=%s while retaining original bytes',
    async (supportsImages) => {
      const { f, bridge } = await setup();
      const contexts: TranscriptContext[] = [];
      const image = { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' };
      try {
        f.faux.models[0].input = supportsImages ? ['text', 'image'] : ['text'];
        bridge.call.mockImplementation(async (input) => {
          await input.beforeDispatch();
          return { kind: 'known', isError: false, content: [image], summary: 'Image result' };
        });
        f.faux.setResponses([
          fauxAssistantMessage(
            [{ type: 'toolCall', id: 'image', name: 'mcp_echo', arguments: { text: 'image' } }],
            { stopReason: 'toolUse' },
          ),
          (context) => {
            contexts.push(context);
            return fauxAssistantMessage('Image result observed');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Return image',
          mode: 'send',
          requestId: 'image',
          mcpTools: [selection],
        });
        await idle(f);
        const result = contexts[0]?.messages.find((message) => message.role === 'toolResult');
        if (!result || result.role !== 'toolResult') throw new Error('Missing model tool result');
        expect(result.content.some((part) => part.type === 'image')).toBe(supportsImages);
        if (!supportsImages)
          expect(JSON.stringify(result.content)).toContain('does not support images');
        const snapshot = f.runtime.getSnapshot(f.session.id);
        const original = f.store
          .getModelContext(f.session.id, snapshot.session.activeBranchId)
          .map(decodeContextMessage)
          .find((message) => message.role === 'toolResult');
        expect(original?.content).toEqual([image]);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('stops after an unknown result, retains the queue, pairs the unentered call and preserves an explicit verification blocker', async () => {
    const { f, bridge } = await setup();
    const waiting = gate();
    let requests = 0;
    try {
      bridge.call.mockImplementation(async (input) => {
        await input.beforeDispatch();
        await waiting.promise;
        return {
          kind: 'unknown',
          message: 'Result unknown: verify whether the operation took effect.',
        };
      });
      f.faux.setResponses([
        () => {
          requests += 1;
          return fauxAssistantMessage(
            [
              { type: 'toolCall', id: 'first', name: 'mcp_echo', arguments: { text: 'first' } },
              { type: 'toolCall', id: 'second', name: 'mcp_echo', arguments: { text: 'second' } },
            ],
            { stopReason: 'toolUse' },
          );
        },
        () => {
          requests += 1;
          return fauxAssistantMessage('Must not be requested');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Perform two calls',
        mode: 'send',
        requestId: 'unknown',
        mcpTools: [selection],
      });
      await observe(
        f.runtime,
        f.session.id,
        (snapshot) => snapshot.tools[0]?.dispatch.state === 'may_have_started',
      );
      await f.runtime.send(f.session.id, {
        text: 'Retain this input',
        mode: 'follow-up',
        requestId: 'queued',
        mcpTools: [selection],
      });
      waiting.release();
      await idle(f);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(requests).toBe(1);
      expect(bridge.call).toHaveBeenCalledTimes(1);
      expect(snapshot.runs[0]?.status).toBe('failed');
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.tools.map(({ status }) => status)).toEqual(['unknown', 'interrupted']);
      const messages = f.store
        .getModelContext(f.session.id, snapshot.session.activeBranchId)
        .map(decodeContextMessage);
      const results = messages.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(2);
      expect(results.map((message) => message.details)).toEqual([
        { harnessOutcome: 'unknown', origin: 'host' },
        { harnessOutcome: 'interrupted', origin: 'host' },
      ]);
      const unknown = results[0];
      if (!unknown) throw new Error('Missing unknown result');
      expect(summaryRecord(unknown)).toContain('may have taken effect');
      const summary = fallbackSummary(messages, null, f.work.snapshot(f.session.id).state);
      expect(summary.blockers.join('\n')).toContain('RESULT UNKNOWN');
      expect(summary.completed.join('\n')).not.toContain('RESULT UNKNOWN');
      const laterFailures = Array.from({ length: 12 }, (_, index) => ({
        ...unknown,
        details: { harnessOutcome: 'failed', origin: 'host' },
        toolCallId: `later-${index}`,
      }));
      expect(
        fallbackSummary(
          [...messages, ...laterFailures],
          null,
          f.work.snapshot(f.session.id).state,
        ).blockers.join('\n'),
      ).toContain('RESULT UNKNOWN');
      bridge.revoke();
      await expect(f.runtime.resumeQueue(f.session.id)).rejects.toThrow('Grant revoked');
      expect(f.runtime.getSnapshot(f.session.id).queue).toHaveLength(1);
      expect(bridge.call).toHaveBeenCalledTimes(1);
      expect(f.errors).toEqual([]);
    } finally {
      waiting.release();
      await f.close();
    }
  });

  it('does not write to the Server when the durable dispatch barrier fails', async () => {
    const { f, bridge } = await setup();
    let writes = 0;
    try {
      const append = f.store.append.bind(f.store);
      vi.spyOn(f.store, 'append').mockImplementation((id, events) => {
        if (
          events.some(
            ({ type, data }) =>
              type === 'tool.updated' && JSON.stringify(data).includes('may_have_started'),
          )
        )
          throw new Error('Disk unavailable at dispatch barrier');
        return append(id, events);
      });
      bridge.call.mockImplementation(async (input) => {
        await input.beforeDispatch();
        writes += 1;
        return {
          kind: 'known',
          isError: false,
          content: [{ type: 'text', text: 'Unexpected' }],
          summary: 'Unexpected',
        };
      });
      f.faux.setResponses([
        fauxAssistantMessage(
          [{ type: 'toolCall', id: 'blocked', name: 'mcp_echo', arguments: { text: 'input' } }],
          { stopReason: 'toolUse' },
        ),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Fail barrier',
        mode: 'send',
        requestId: 'barrier',
        mcpTools: [selection],
      });
      await vi.waitFor(() => expect(f.errors.length).toBeGreaterThan(0));
      await f.runtime.close();
      expect(writes).toBe(0);
      expect(f.store.getSnapshot(f.session.id).tools[0]?.dispatch.state).toBe('not_started');
      expect(f.store.getSnapshot(f.session.id).tools[0]?.status).not.toBe('completed');
      expect(() => f.runtime.getSnapshot(f.session.id)).toThrow(
        expect.objectContaining({ code: 'SESSION_UNAVAILABLE' }),
      );
    } finally {
      await f.close();
    }
  });

  it('stops the loop on an unencodable result and recovers the unresolved barrier as unknown', async () => {
    const { f, bridge } = await setup();
    let requests = 0;
    try {
      bridge.call.mockImplementation(async (input) => {
        await input.beforeDispatch();
        return {
          kind: 'known',
          isError: false,
          content: Array.from({ length: 129 }, () => ({ type: 'text', text: '' })),
          summary: 'Invalid host projection',
        };
      });
      f.faux.setResponses([
        () => {
          requests += 1;
          return fauxAssistantMessage(
            [
              {
                type: 'toolCall',
                id: 'unencodable',
                name: 'mcp_echo',
                arguments: { text: 'input' },
              },
            ],
            { stopReason: 'toolUse' },
          );
        },
        () => {
          requests += 1;
          return fauxAssistantMessage('Must not continue');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Observe encoding failure',
        mode: 'send',
        requestId: 'encoding',
        mcpTools: [selection],
      });
      await vi.waitFor(() => expect(f.errors.length).toBeGreaterThan(0));
      await f.runtime.close();
      expect(requests).toBe(1);
      expect(() => f.runtime.getSnapshot(f.session.id)).toThrow(
        expect.objectContaining({ code: 'SESSION_UNAVAILABLE' }),
      );
      f.store.recoverInterrupted();
      expect(f.store.getSnapshot(f.session.id).tools[0]?.status).toBe('unknown');
    } finally {
      await f.close();
    }
  });

  it.each(['error', 'aborted'] as const)(
    'does not invent call intents from an assistant that ended with %s',
    async (stopReason) => {
      const { f, bridge } = await setup();
      try {
        f.faux.setResponses([
          fauxAssistantMessage(
            [{ type: 'toolCall', id: 'partial', name: 'mcp_echo', arguments: { text: 'partial' } }],
            { stopReason },
          ),
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Partial response',
          mode: 'send',
          requestId: stopReason,
          mcpTools: [selection],
        });
        await idle(f);
        expect(bridge.call).not.toHaveBeenCalled();
        expect(f.runtime.getSnapshot(f.session.id).tools).toEqual([]);
        expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('failed');
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it.each([
    {
      label: 'oversized call ID',
      calls: [
        {
          type: 'toolCall' as const,
          id: 'x'.repeat(513),
          name: 'mcp_echo',
          arguments: { text: 'input' },
        },
      ],
    },
    {
      label: 'oversized tool name',
      calls: [
        {
          type: 'toolCall' as const,
          id: 'invalid',
          name: 'x'.repeat(2049),
          arguments: { text: 'input' },
        },
      ],
    },
    {
      label: 'duplicate call ID',
      calls: Array.from({ length: 2 }, () => ({
        type: 'toolCall' as const,
        id: 'duplicate',
        name: 'mcp_echo',
        arguments: { text: 'input' },
      })),
    },
  ])('rejects $label before saving an unrecoverable assistant intent', async ({ calls }) => {
    const { f, bridge } = await setup();
    try {
      f.faux.setResponses([fauxAssistantMessage(calls, { stopReason: 'toolUse' })]);
      await f.runtime.send(f.session.id, {
        text: 'Reject malformed identity',
        mode: 'send',
        requestId: 'identity',
        mcpTools: [selection],
      });
      await idle(f);
      expect(bridge.call).not.toHaveBeenCalled();
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.runs[0]?.status).toBe('failed');
      expect(snapshot.tools).toEqual([]);
      const assistant = (await batches(f))
        .flatMap(({ records }) => records)
        .find(({ event }) => event.type === 'message.completed');
      expect(assistant?.event.data).toMatchObject({ message: { status: 'failed' } });
      expect(assistant?.privateData).toBeNull();
      expect(() => f.store.recoverInterrupted()).not.toThrow();
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
