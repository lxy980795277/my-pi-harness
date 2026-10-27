import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createModels,
  fauxAssistantMessage,
  type AssistantMessage,
  type ToolCall,
} from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai';
import type {
  SessionSnapshot,
  SessionSummary,
  ContextSummary,
  QuestionResponse,
  QuestionItem,
  Question,
  Todo,
} from '@my-pi-harness/protocol';
import { openProfileStore } from '@my-pi-harness/storage';
import { RuntimeError } from '../../src/errors.js';
import { SessionRuntime } from '../../src/session-runtime.js';
import { ToolRuntime } from '../../src/tool-runtime.js';
import type { ToolRuntimeOptions } from '../../src/tool-types.js';
import type { ExternalTools } from '../../src/external-tools.js';
import type { WebFetchGatewayAccess } from '@my-pi-harness/execution';
import type { SkillsPort, ToolDiscoveryPort } from '../../src/capability-ports.js';
import { WorkRuntime } from '../../src/work-runtime.js';

interface WorkFixture {
  directory: string;
  profile: string;
  root: string;
  store: Awaited<ReturnType<typeof openProfileStore>>;
  faux: ReturnType<typeof fauxProvider>;
  errors: unknown[];
  runtime: SessionRuntime;
  tools: ToolRuntime | undefined;
  work: WorkRuntime;
  session: SessionSummary;
  releases(): number;
  close(): Promise<void>;
}

interface WorkFixtureOptions {
  externalTools?: ExternalTools;
  discovery?: ToolDiscoveryPort;
  skills?: SkillsPort;
  skillGateway?: WebFetchGatewayAccess;
  sessionTools?: boolean;
  tools?: boolean;
  context?: boolean;
}

export async function fixture(
  withWorkspace = false,
  options: WorkFixtureOptions = {},
): Promise<WorkFixture> {
  const temporary = await mkdtemp(join(tmpdir(), 'my-pi-work-runtime-'));
  const directory = await realpath(temporary);
  const profile = join(directory, 'profile');
  const root = join(directory, 'workspace');
  await mkdir(root);
  const store = await openProfileStore(profile);
  try {
    const faux = fauxProvider({ tokensPerSecond: 0, tokenSize: { min: 64, max: 64 } });
    const models = createModels();
    models.setProvider(faux.provider);
    const errors: unknown[] = [];
    let releases = 0;
    const gateway = {
      resolve: () =>
        Promise.resolve({
          model: faux.models[0],
          streamFn: models.streamSimple.bind(models),
          release: () => {
            releases += 1;
          },
        }),
    };
    const workspace = store.createWorkspace({
      id: 'workspace',
      name: 'Project',
      icon: 'folder',
      rootPath: root,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const resolveWorkspace = (id: string) => {
      if (id !== workspace.id)
        throw new RuntimeError('WORKSPACE_NOT_FOUND', 'Unknown test workspace');
      return Promise.resolve(workspace);
    };
    const sessions = (): SessionRuntime => runtime;
    const work = new WorkRuntime({
      store,
      gateway,
      profileDirectory: profile,
      resolveWorkspace,
      command: (id, operation, allowActive) => sessions().workCommand(id, operation, allowActive),
      commit: (id, events) => sessions().record(id, events),
    });
    let tools: ToolRuntime | undefined;
    if (options.tools !== false) {
      const toolOptions: ToolRuntimeOptions = {
        profileDirectory: profile,
        resolveWorkspace,
      };
      if (options.sessionTools !== false) toolOptions.work = work;
      if (options.externalTools) toolOptions.externalTools = options.externalTools;
      if (options.skillGateway) toolOptions.skillGateway = options.skillGateway;
      tools = new ToolRuntime(toolOptions);
    }
    const runtimeOptions: ConstructorParameters<typeof SessionRuntime>[0] = {
      store,
      gateway,
      onError: (error) => {
        errors.push(error);
      },
    };
    if (options.context !== false) runtimeOptions.work = work;
    if (options.externalTools) runtimeOptions.externalTools = options.externalTools;
    if (options.discovery) runtimeOptions.discovery = options.discovery;
    if (options.skills) runtimeOptions.skills = options.skills;
    if (tools) runtimeOptions.tools = tools;
    const runtime = new SessionRuntime(runtimeOptions);
    const session = runtime.createSession({
      title: 'M3 work',
      providerId: faux.provider.id,
      modelId: faux.models[0].id,
      thinkingLevel: 'off',
      workspaceId: withWorkspace ? workspace.id : null,
      approvalMode: 'ask',
    });
    return {
      directory,
      profile,
      root,
      store,
      faux,
      errors,
      runtime,
      tools,
      work,
      session,
      releases: () => releases,
      close: async (): Promise<void> => {
        work.close();
        await sessions().close();
        store.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    store.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Wait for a committed runtime observation, with a deadline that fails the test. */
export async function observe(
  runtime: SessionRuntime,
  sessionId: string,
  predicate: (snapshot: SessionSnapshot) => boolean,
): Promise<void> {
  if (predicate(runtime.getSnapshot(sessionId))) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Expected work runtime observation did not arrive'));
    }, 5000);
    const unsubscribe = runtime.subscribe(sessionId, () => {
      if (!predicate(runtime.getSnapshot(sessionId))) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

export async function idle(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await observe(f.runtime, f.session.id, (snapshot) => snapshot.session.activeRunId === null);
  await f.runtime.cancel(f.session.id);
}

export function call(name: string, args: ToolCall['arguments'], id = name): AssistantMessage {
  return fauxAssistantMessage([{ type: 'toolCall', id, name, arguments: args }], {
    stopReason: 'toolUse',
  });
}
export function questionArgs(
  prompt: string,
  options: string[] = [],
): { questions: QuestionItem[] } {
  return {
    questions: [
      {
        id: 'question',
        header: 'Question',
        prompt,
        options: options.map((label, index) => ({ id: String(index), label, description: '' })),
        multiSelect: false,
        allowCustomInput: true,
      },
    ],
  };
}
export function answerText(text: string): QuestionResponse[] {
  return [{ questionId: 'question', optionIds: [], text }];
}
export function summary(text: string): string {
  return JSON.stringify({
    objective: text,
    constraints: [],
    decisions: [],
    completed: [],
    pending: [],
    blockers: [],
    nextAction: 'Continue',
  } satisfies ContextSummary);
}
export function todo(id: string, title: string, status: Todo['status']): Todo {
  return {
    id,
    title,
    status,
    planStepId: null,
    evidenceToolCallIds: [],
    completionNote: status === 'completed' ? 'User-confirmed analytical conclusion.' : null,
  };
}
export function pendingQuestion(f: Awaited<ReturnType<typeof fixture>>): Question {
  const question = f.work
    .snapshot(f.session.id)
    .state.questions.find((entry) => entry.status === 'pending');
  if (!question) throw new Error('Missing pending question');
  return question;
}

export async function sendTurn(
  f: Awaited<ReturnType<typeof fixture>>,
  text: string,
  response: string,
): Promise<void> {
  f.faux.setResponses([fauxAssistantMessage(response)]);
  await f.runtime.send(f.session.id, { text, mode: 'send', requestId: text });
  await idle(f);
}

export function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export async function withinDeadline<T>(pending: Promise<T>, failure: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(failure)), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
