import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Message,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { openProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { ToolRuntime } from '../src/tools/runtime.js';
import { SessionRuntime } from '../src/sessions/runtime.js';
import { decodeContextMessage, encodeContextMessage } from '../src/context/codec.js';
import { completeToolHistory } from '../src/context/tool-history.js';

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Expected tool state did not arrive');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(mode: 'ask' | 'read-only' = 'ask') {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-tools-'));
  const profile = join(directory, 'profile');
  const root = join(directory, 'project');
  await mkdir(root);
  const store = await openProfileStore(profile);
  const workspace = store.createWorkspace({
    id: 'workspace',
    name: 'Project',
    icon: 'folder',
    rootPath: await realpath(root),
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  const tools = new ToolRuntime({
    profileDirectory: profile,
    resolveWorkspace: () => Promise.resolve(workspace),
    approvalTimeoutMs: 5000,
  });
  const errors: unknown[] = [];
  const runtime = new SessionRuntime({
    store,
    tools,
    gateway: {
      resolve: () =>
        Promise.resolve({
          model: faux.models[0],
          streamFn: models.streamSimple.bind(models),
          release: () => undefined,
        }),
    },
    onError: (error) => errors.push(error),
  });
  const session = runtime.createSession({
    title: 'Tool session',
    providerId: faux.provider.id,
    modelId: faux.models[0].id,
    thinkingLevel: 'off',
    workspaceId: workspace.id,
    approvalMode: mode,
  });
  return {
    directory,
    root,
    store,
    faux,
    runtime,
    tools,
    session,
    errors,
    close: async (): Promise<void> => {
      await runtime.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
function writeCall() {
  return fauxAssistantMessage(
    [
      {
        type: 'toolCall',
        id: 'write-call',
        name: 'write_file',
        arguments: { path: 'result.txt', content: 'approved output\n', expectedHash: null },
      },
    ],
    { stopReason: 'toolUse' },
  );
}

describe('durable Pi tool execution', () => {
  it('keeps reused provider call IDs independent across assistant turns and branch replay', async () => {
    const f = await fixture();
    const call = (path: string, content: string) =>
      fauxAssistantMessage(
        [
          {
            type: 'toolCall',
            id: 'call_0',
            name: 'write_file',
            arguments: { path, content, expectedHash: null },
          },
        ],
        { stopReason: 'toolUse' },
      );
    try {
      f.faux.setResponses([
        call('first.txt', 'first result'),
        call('second.txt', 'second result'),
        fauxAssistantMessage('Both writes completed'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Write two files',
        mode: 'send',
        requestId: 'two-rounds',
      });
      await until(
        () => f.runtime.getSnapshot(f.session.id).tools[0]?.status === 'awaiting_approval',
      );
      const first = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!first) throw new Error('Missing first approval');
      f.tools.decide(f.session.id, first.id, { decision: 'allow' });
      await until(
        () => f.runtime.getSnapshot(f.session.id).tools[1]?.status === 'awaiting_approval',
      );
      const second = f.runtime.getSnapshot(f.session.id).tools[1];
      if (!second) throw new Error('Missing second approval');
      expect(second.id).not.toBe(first.id);
      expect(() => f.tools.decide(f.session.id, first.id, { decision: 'allow' })).toThrow('已结束');
      await expect(readFile(join(f.root, 'second.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      f.tools.decide(f.session.id, second.id, { decision: 'allow' });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(await readFile(join(f.root, 'first.txt'), 'utf8')).toBe('first result');
      expect(await readFile(join(f.root, 'second.txt'), 'utf8')).toBe('second result');
      const completed = f.runtime.getSnapshot(f.session.id);
      expect(completed.runs[0]?.status).toBe('completed');
      expect(completed.tools.map((tool) => tool.status)).toEqual(['completed', 'completed']);
      const assistantSteps = completed.messages.filter((message) => message.role === 'assistant');
      expect(assistantSteps).toHaveLength(3);
      for (const message of assistantSteps) {
        expect(message.usage?.totalTokens).toBeGreaterThan(0);
        expect(message.finishedAt).toBeGreaterThanOrEqual(message.createdAt);
      }
      expect(assistantSteps.slice(0, 2).map((message) => message.text)).toEqual(['', '']);
      const history = f.store
        .getModelContext(f.session.id, completed.session.activeBranchId)
        .map(decodeContextMessage);
      expect(
        history
          .filter((message) => message.role === 'toolResult')
          .map((message) => message.toolCallId),
      ).toEqual(['call_0', 'call_0']);
      expect(completeToolHistory(history)).toEqual(history);

      f.faux.setResponses([
        fauxAssistantMessage('Follow up'),
        fauxAssistantMessage('Branched follow up'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Follow up',
        mode: 'send',
        requestId: 'after-tools',
      });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      const next = f.runtime
        .getSnapshot(f.session.id)
        .messages.filter((message) => message.role === 'user')
        .at(-1);
      if (!next) throw new Error('Missing follow-up input');
      await f.runtime.editAndResend(f.session.id, {
        messageId: next.id,
        text: 'Different follow up',
        requestId: 'branch-after-tools',
      });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      const branch = f.runtime.getSnapshot(f.session.id);
      expect(branch.session.activeBranchId).not.toBe(completed.session.activeBranchId);
      expect(branch.tools.map((tool) => tool.id)).toEqual([first.id, second.id]);
      const replay = f.store
        .getModelContext(f.session.id, branch.session.activeBranchId)
        .map(decodeContextMessage);
      expect(replay.filter((message) => message.role === 'toolResult')).toHaveLength(2);
      expect(completeToolHistory(replay)).toEqual(replay);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('waits for the exact approval, writes once, feeds a real tool result back and replays the branch', async () => {
    const f = await fixture();
    try {
      const contexts: TranscriptContext[] = [];
      f.faux.setResponses([
        writeCall(),
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('File saved');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Create a file',
        mode: 'send',
        requestId: 'write',
      });
      await until(
        () => f.runtime.getSnapshot(f.session.id).tools[0]?.status === 'awaiting_approval',
      );
      const tool = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!tool) throw new Error('Missing tool card');
      await expect(readFile(join(f.root, 'result.txt'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(() => f.tools.decide('another-session', tool.id, { decision: 'allow' })).toThrow(
        '不属于',
      );
      f.tools.decide(f.session.id, tool.id, { decision: 'allow' });
      expect(() => f.tools.decide(f.session.id, tool.id, { decision: 'allow' })).toThrow('已结束');
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(
        f.runtime.getSnapshot(f.session.id).tools[0],
        JSON.stringify(f.runtime.getSnapshot(f.session.id).tools),
      ).toMatchObject({ status: 'completed' });
      expect(await readFile(join(f.root, 'result.txt'), 'utf8')).toBe('approved output\n');
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.tools[0]).toMatchObject({ status: 'completed', name: 'write_file' });
      expect(snapshot.tools[0]?.diff).toContain('+approved output');
      expect(
        contexts[0]?.messages.some((message) => message.role === 'toolResult' && !message.isError),
      ).toBe(true);
      const history = f.store
        .getModelContext(f.session.id, snapshot.session.activeBranchId)
        .map(decodeContextMessage);
      expect(history.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'toolResult',
        'assistant',
      ]);
      expect(completeToolHistory(history)).toEqual(history);
      const calls = f.store
        .readEvents(f.session.id, 0, 1000)
        .filter((event) => event.type === 'tool.context');
      expect(calls).toHaveLength(1);
      expect(JSON.stringify(calls)).not.toContain('codecVersion');
      f.faux.setResponses([fauxAssistantMessage('Edited first turn')]);
      const user = snapshot.messages.find((message) => message.role === 'user');
      if (!user) throw new Error('Missing user input');
      await f.runtime.editAndResend(f.session.id, {
        messageId: user.id,
        text: 'Different request',
        requestId: 'fork',
      });
      await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
      expect(f.runtime.getSnapshot(f.session.id).tools).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each(['deny', 'cancel', 'read-only'] as const)(
    'does not write when the decision is %s',
    async (decision) => {
      const f = await fixture(decision === 'read-only' ? 'read-only' : 'ask');
      try {
        f.faux.setResponses([writeCall(), fauxAssistantMessage('No write')]);
        await f.runtime.send(f.session.id, { text: 'Create', mode: 'send', requestId: 'denied' });
        if (decision !== 'read-only') {
          await until(
            () => f.runtime.getSnapshot(f.session.id).tools[0]?.status === 'awaiting_approval',
          );
          const tool = f.runtime.getSnapshot(f.session.id).tools[0];
          if (!tool) throw new Error('Missing pending tool');
          if (decision === 'cancel') await f.runtime.cancel(f.session.id);
          else f.tools.decide(f.session.id, tool.id, { decision: 'deny' });
        }
        await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
        expect(f.runtime.getSnapshot(f.session.id).tools[0]?.status).toBe(
          decision === 'cancel' ? 'cancelled' : 'denied',
        );
        await expect(readFile(join(f.root, 'result.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it.each(['unknown', 'truncated'] as const)(
    'persists a rejected %s tool result without disabling the session',
    async (kind) => {
      const f = await fixture();
      try {
        const name = kind === 'unknown' ? 'unknown_tool_'.repeat(20) : 'write_file';
        f.faux.setResponses([
          fauxAssistantMessage(
            [
              {
                type: 'toolCall',
                id: 'rejected-call',
                name,
                arguments: { path: 'created.txt', content: 'must not write', expectedHash: null },
              },
            ],
            { stopReason: kind === 'truncated' ? 'length' : 'toolUse' },
          ),
          fauxAssistantMessage('The tool was rejected'),
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Reject invalid call',
          mode: 'send',
          requestId: 'invalid-tool',
        });
        await until(() => f.runtime.getSnapshot(f.session.id).session.activeRunId === null);
        expect(f.runtime.getSnapshot(f.session.id).tools[0]).toMatchObject({ status: 'failed' });
        expect(
          f.store
            .getModelContext(f.session.id, f.session.activeBranchId)
            .map(decodeContextMessage)
            .some((message) => message.role === 'toolResult' && message.isError),
        ).toBe(true);
        await expect(readFile(join(f.root, 'created.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('reads both codec generations and removes an incomplete tool cycle after interruption', () => {
    const user: Message = { role: 'user', content: 'Question', timestamp: 1 };
    const call = writeCall();
    expect(
      decodeContextMessage(JSON.stringify({ codecVersion: 1, sdkVersion: '1.1.0', message: user })),
    ).toEqual(user);
    expect(decodeContextMessage(encodeContextMessage(call))).toEqual(call);
    expect(completeToolHistory([user, call])).toEqual([user]);
    const result: Message = {
      role: 'toolResult',
      toolCallId: 'write-call',
      toolName: 'write_file',
      content: [{ type: 'text', text: 'unknown outcome' }],
      isError: true,
      timestamp: 2,
    };
    expect(decodeContextMessage(encodeContextMessage(result))).toEqual(result);
    expect(completeToolHistory([user, call, result])).toEqual([user, call, result]);
  });
});
