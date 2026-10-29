import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import {
  defaultAgentSettings,
  type MessageView,
  type RunView,
  type ToolCallRecord,
} from '@my-pi-harness/protocol';
import { openProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { decodeContextMessage, encodeContextMessage } from '../src/context/codec.js';
import { toolCallRecordId } from '../src/tools/runtime.js';
import { WorkRuntime } from '../src/work/runtime.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-task-work-'));
  const store = await openProfileStore(directory);
  const session = store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Task work',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  const root: RunView = {
    id: 'root',
    sessionId: session.id,
    branchId: 'main',
    providerId: 'provider',
    modelId: 'model',
    status: 'running',
    createdAt: 2,
    finishedAt: null,
    error: null,
  };
  const user: MessageView = {
    id: 'root-user',
    sessionId: session.id,
    branchId: 'main',
    runId: root.id,
    role: 'user',
    text: 'Delegate independent tasks',
    thinking: '',
    createdAt: 2,
    status: 'complete',
    stopReason: null,
  };
  const assistant: MessageView = {
    ...user,
    id: 'root-assistant',
    role: 'assistant',
    text: '',
    stopReason: 'toolUse',
  };
  const names = ['alpha', 'beta'];
  const sdk = fauxAssistantMessage(
    names.map((name) => ({
      type: 'toolCall' as const,
      id: name,
      name: 'spawn_agent',
      arguments: { title: name },
    })),
    { stopReason: 'toolUse' },
  );
  store.append(session.id, [
    { type: 'run.accepted', runId: root.id, at: 2, data: { run: root, requestId: 'root' } },
    {
      type: 'message.started',
      runId: root.id,
      at: 2,
      data: user,
      privateData: encodeContextMessage({ role: 'user', content: user.text, timestamp: 2 }),
    },
    {
      type: 'message.started',
      runId: root.id,
      at: 3,
      data: { ...assistant, status: 'streaming', stopReason: null },
    },
    {
      type: 'message.completed',
      runId: root.id,
      at: 3,
      data: { message: assistant },
      privateData: encodeContextMessage(sdk),
    },
  ]);
  const settings = defaultAgentSettings();
  const role = settings.roles[0];
  if (!role) throw new Error('Missing default role');
  for (const name of names) {
    const source: ToolCallRecord = {
      id: toolCallRecordId(root.id, assistant.id, name),
      sessionId: session.id,
      runId: root.id,
      branchId: 'main',
      name: 'spawn_agent',
      arguments: { title: name },
      binding: { kind: 'accepted', source: { kind: 'session' }, fingerprint: 'a'.repeat(64) },
      dispatch: { state: 'not_applicable' },
      status: 'running',
      summary: name,
      result: null,
      diff: null,
      createdAt: 3,
      updatedAt: 3,
    };
    const run: RunView = { ...root, id: `${name}-run`, taskId: name, createdAt: 4 };
    const message: MessageView = {
      ...user,
      id: `${name}-user`,
      runId: run.id,
      text: `${name} private observation`,
      createdAt: 4,
    };
    store.append(session.id, [
      { type: 'tool.requested', runId: root.id, at: 3, data: { tool: source } },
      {
        type: 'task.created',
        runId: root.id,
        at: 4,
        data: {
          task: {
            id: name,
            sourceToolCallId: source.id,
            title: name,
            role,
            limits: settings.limits,
            createdAt: 4,
          },
        },
      },
      { type: 'run.accepted', runId: run.id, at: 4, data: { run, requestId: name } },
      {
        type: 'message.started',
        runId: run.id,
        at: 4,
        data: message,
        privateData: encodeContextMessage({ role: 'user', content: message.text, timestamp: 4 }),
      },
    ]);
  }
  const work = new WorkRuntime({
    store,
    profileDirectory: directory,
    gateway: { resolve: () => Promise.reject(new Error('Unexpected model request')) },
    resolveWorkspace: () => Promise.reject(new Error('Unexpected workspace request')),
    command: async (id, operation) => await operation(store.getSnapshot(id)),
    commit: (id, events) => {
      store.append(id, events);
    },
  });
  return {
    session,
    store,
    work,
    close: async () => {
      work.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('task-local context and work', () => {
  it('projects and audits only the selected task input without updating the root context usage', async () => {
    const f = await fixture();
    try {
      const alpha = f.work.forTask(f.session.id, 'alpha');
      const task = f.store.getTaskSnapshot(f.session.id, 'alpha');
      const run = task.runs[0];
      if (!run) throw new Error('Missing task run');
      const faux = fauxProvider({ tokensPerSecond: 0 });
      const models = createModels();
      models.setProvider(faux.provider);
      const messages = await alpha.context.project({
        session: f.session,
        run,
        resolved: {
          model: faux.models[0],
          streamFn: models.streamSimple.bind(models),
          release: () => undefined,
        },
        messages: f.store.getTaskModelContext(f.session.id, 'alpha').map(decodeContextMessage),
        basePrompt: 'Task-local rules',
        currentTask: 'alpha private observation',
        toolDefinitions: [],
        signal: new AbortController().signal,
      });
      expect(JSON.stringify(messages)).toContain('alpha private observation');
      expect(JSON.stringify(messages)).not.toContain('beta private observation');
      expect(JSON.stringify(messages)).not.toContain('Delegate independent tasks');
      expect(alpha.snapshot(f.session.id).state.usage).not.toBeNull();
      expect(f.work.snapshot(f.session.id).state.usage).toBeNull();
      expect(f.work.forTask(f.session.id, 'beta').snapshot(f.session.id).state.usage).toBeNull();
      expect(
        f.store.readEvents(f.session.id).find((event) => event.type === 'context.prepared')?.data,
      ).toMatchObject({ taskId: 'alpha', messageIds: ['alpha-user'] });
    } finally {
      await f.close();
    }
  });

  it('keeps root, sibling history and todos separate inside one session journal', async () => {
    const f = await fixture();
    try {
      const alpha = f.work.forTask(f.session.id, 'alpha');
      const beta = f.work.forTask(f.session.id, 'beta');
      const state = alpha.snapshot(f.session.id).state;
      alpha.save(
        f.session.id,
        {
          ...state,
          todos: [
            {
              id: 'alpha-todo',
              title: 'Only alpha owns this',
              status: 'pending',
              planStepId: null,
              evidenceToolCallIds: [],
              completionNote: null,
            },
          ],
        },
        'alpha-run',
      );
      expect(alpha.snapshot(f.session.id).state.todos).toHaveLength(1);
      expect(beta.snapshot(f.session.id).state.todos).toEqual([]);
      expect(f.work.snapshot(f.session.id).state.todos).toEqual([]);
      expect(alpha.sessionSnapshot(f.session.id).messages.map(({ id }) => id)).toEqual([
        'alpha-user',
      ]);
      expect(alpha.searchHistory(f.session.id, 'beta')).not.toContain('beta private observation');
      expect(alpha.searchHistory(f.session.id, 'alpha')).toContain('alpha private observation');
      expect(() => alpha.snapshot('other-session')).toThrow('不属于此会话');
      expect(() => alpha.forTask(f.session.id, 'beta')).toThrow('其他任务');
      expect(() =>
        alpha.createCheckpoint(f.session.id, { expectedBranchId: 'main', label: 'Invalid' }),
      ).toThrow('只允许用于主会话');
    } finally {
      await f.close();
    }
  });

  it('answers only the selected task waiter and leaves sibling and root questions untouched', async () => {
    const f = await fixture();
    const alpha = f.work.forTask(f.session.id, 'alpha');
    const beta = f.work.forTask(f.session.id, 'beta');
    const controller = new AbortController();
    const questions = [
      {
        id: 'q',
        header: 'Choice',
        prompt: 'Which?',
        options: [],
        multiSelect: false,
        allowCustomInput: true,
      },
    ];
    const pending = alpha.ask(
      f.session.id,
      'alpha-run',
      'alpha-tool',
      questions,
      controller.signal,
    );
    try {
      const question = alpha.snapshot(f.session.id).state.questions[0];
      if (!question) throw new Error('Missing task question');
      const answers = [{ questionId: 'q', optionIds: [], text: 'alpha only' }];
      await expect(beta.answer(f.session.id, question.id, answers)).rejects.toMatchObject({
        code: 'QUESTION_CONFLICT',
      });
      await expect(f.work.answer(f.session.id, question.id, answers)).rejects.toMatchObject({
        code: 'QUESTION_CONFLICT',
      });
      await f.work.answer(f.session.id, question.id, answers, 'alpha');
      expect(await pending).toContain('alpha only');
      expect(alpha.snapshot(f.session.id).state.questions[0]?.status).toBe('answered');
      expect(beta.snapshot(f.session.id).state.questions).toEqual([]);
      expect(f.work.snapshot(f.session.id).state.questions).toEqual([]);
    } finally {
      controller.abort();
      await Promise.allSettled([pending]);
      await f.close();
    }
  });
});
