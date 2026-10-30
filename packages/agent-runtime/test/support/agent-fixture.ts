import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createModels,
  createAssistantMessageEventStream,
  fauxProvider,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type TranscriptContext,
  type Usage,
} from '@earendil-works/pi-ai';
import type { AgentSettings, ApprovalMode, SessionSummary } from '@my-pi-harness/protocol';
import { openProfileStore } from '@my-pi-harness/storage';
import type { ResolvedModel } from '../../src/models/gateway.js';
import { SessionRuntime } from '../../src/sessions/runtime.js';
import { ToolRuntime } from '../../src/tools/runtime.js';
import type { ExternalTools } from '../../src/tools/external.js';
import type { ApprovalReviewer } from '../../src/tools/approval-review.js';
import type { SkillsPort, ToolDiscoveryPort } from '../../src/capabilities/ports.js';
import { WorkRuntime } from '../../src/work/runtime.js';

interface AgentFixtureOptions {
  response(context: TranscriptContext): AssistantMessage | Promise<AssistantMessage>;
  settings?(settings: AgentSettings): AgentSettings;
  beforeResolve?(index: number, signal: AbortSignal | undefined): Promise<void>;
  beforeStream?(
    context: TranscriptContext,
    signal: AbortSignal | undefined,
    sessionId: string | undefined,
  ): Promise<void>;
  reportedUsage?(context: TranscriptContext): Usage;
  workspace?: boolean;
  approvalMode?: ApprovalMode;
  externalTools?: ExternalTools;
  reviewer?: ApprovalReviewer;
  skills?: SkillsPort;
  discovery?: ToolDiscoveryPort;
}

export interface AgentGate {
  promise: Promise<void>;
  release(): void;
}

export interface AgentFixture {
  directory: string;
  store: Awaited<ReturnType<typeof openProfileStore>>;
  runtime: SessionRuntime;
  work: WorkRuntime;
  tools: ToolRuntime;
  session: SessionSummary;
  requests: { task: string; json: string }[];
  errors: unknown[];
  maxRequests(): number;
  leases(): { acquired: number; released: number };
  close(): Promise<void>;
}

export function agentGate(): AgentGate {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Test barriers reject on the owned signal, including preparation before a model lease exists. */
export function waitAtGate(gate: AgentGate, signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = (): void => {
      signal?.removeEventListener('abort', abort);
      const reason: unknown = signal?.reason;
      reject(reason instanceof Error ? reason : new Error('Aborted test barrier'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    gate.promise.then(finish, reject);
    if (signal?.aborted) abort();
  });
}

export function firstTask(context: TranscriptContext): string {
  const message = context.messages.find((entry) => entry.role === 'user');
  if (!message) throw new Error('Missing user task');
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/** Replace faux estimates at the SDK terminal event to exercise provider usage and its absence. */
async function forwardReportedUsage(
  source: AssistantMessageEventStream,
  target: AssistantMessageEventStream,
  usage: Usage,
): Promise<void> {
  for await (const event of source) {
    if (event.type === 'done') target.push({ ...event, message: { ...event.message, usage } });
    else if (event.type === 'error') target.push({ ...event, error: { ...event.error, usage } });
    else target.push(event);
  }
  target.end({ ...(await source.result()), usage });
}

export async function agentFixture(options: AgentFixtureOptions): Promise<AgentFixture> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-agents-')));
  const store = await openProfileStore(join(directory, 'profile'));
  const faux = fauxProvider({ tokensPerSecond: 0, tokenSize: { min: 128, max: 128 } });
  const models = createModels();
  models.setProvider(faux.provider);
  const errors: unknown[] = [];
  const requests: { task: string; json: string }[] = [];
  const streams = new Set<Promise<void>>();
  let activeRequests = 0;
  let maxRequests = 0;
  let resolutionCount = 0;
  let acquiredLeases = 0;
  let releasedLeases = 0;
  faux.setResponses(
    Array.from({ length: 96 }, () => (context: TranscriptContext) => {
      requests.push({ task: firstTask(context), json: JSON.stringify(context.messages) });
      return options.response(context);
    }),
  );
  const streamFn: ResolvedModel['streamFn'] = async (model, context, input) => {
    if (options.beforeStream) await options.beforeStream(context, input?.signal, input?.sessionId);
    input?.signal?.throwIfAborted();
    activeRequests += 1;
    maxRequests = Math.max(maxRequests, activeRequests);
    let stream = models.streamSimple(model, context, input);
    if (options.reportedUsage) {
      const target = createAssistantMessageEventStream();
      const forwarded = forwardReportedUsage(stream, target, options.reportedUsage(context));
      const forwarding = forwarded.finally(() => streams.delete(forwarding));
      streams.add(forwarding);
      stream = target;
    }
    const release = (): void => {
      activeRequests -= 1;
    };
    const settled = stream
      .result()
      .then(release, release)
      .finally(() => streams.delete(settled));
    streams.add(settled);
    return stream;
  };
  const gateway = {
    resolve: async (_providerId: string, _modelId: string, signal?: AbortSignal) => {
      resolutionCount += 1;
      if (options.beforeResolve) await options.beforeResolve(resolutionCount, signal);
      signal?.throwIfAborted();
      acquiredLeases += 1;
      let released = false;
      return {
        model: faux.models[0],
        streamFn,
        release: (): void => {
          if (released) throw new Error('Model lease released twice');
          released = true;
          releasedLeases += 1;
        },
      };
    },
  };
  const resolveWorkspace = (id: string) => {
    const workspace = store.getWorkspace(id);
    if (!workspace) return Promise.reject(new Error('Unknown test workspace'));
    return Promise.resolve(workspace);
  };
  const work: WorkRuntime = new WorkRuntime({
    store,
    gateway,
    profileDirectory: join(directory, 'profile'),
    resolveWorkspace,
    command: (id, operation, allowActive) => runtime.workCommand(id, operation, allowActive),
    commit: (id, events) => runtime.record(id, events),
  });
  const tools: ToolRuntime = new ToolRuntime({
    profileDirectory: join(directory, 'profile'),
    resolveWorkspace,
    work,
    ...(options.externalTools ? { externalTools: options.externalTools } : {}),
    ...(options.reviewer ? { reviewer: options.reviewer } : {}),
  });
  if (options.settings) store.putAgentSettings(options.settings(store.getAgentSettings()));
  const runtime: SessionRuntime = new SessionRuntime({
    store,
    agentStore: store,
    gateway,
    tools,
    work,
    ...(options.externalTools ? { externalTools: options.externalTools } : {}),
    ...(options.skills ? { skills: options.skills } : {}),
    ...(options.discovery ? { discovery: options.discovery } : {}),
    onError: (error) => errors.push(error),
  });
  if (options.workspace) {
    const rootPath = join(directory, 'workspace');
    await mkdir(rootPath);
    store.createWorkspace({
      id: 'workspace',
      name: 'Agent test workspace',
      icon: 'folder',
      rootPath,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  }
  const session = runtime.createSession({
    title: 'Agent integration',
    providerId: faux.provider.id,
    modelId: faux.models[0].id,
    thinkingLevel: 'off',
    workspaceId: options.workspace ? 'workspace' : null,
    approvalMode: options.approvalMode ?? 'ask',
  });
  return {
    directory,
    store,
    runtime,
    work,
    session,
    tools,
    requests,
    errors,
    maxRequests: () => maxRequests,
    leases: () => ({ acquired: acquiredLeases, released: releasedLeases }),
    async close() {
      work.close();
      try {
        await runtime.close();
        await Promise.all(streams);
      } finally {
        store.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

/** Observe committed events rather than waiting an arbitrary amount of time. */
export function agentChanged(
  f: AgentFixture,
  predicate: () => boolean,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let unsubscribe = (): void => undefined;
    const cleanup = (): void => {
      clearTimeout(timer);
      unsubscribe();
    };
    const check = (): void => {
      try {
        if (!predicate()) return;
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(
          error instanceof Error ? error : new Error('Task observer failed', { cause: error }),
        );
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out: ${label}`));
    }, 7000);
    unsubscribe = f.runtime.subscribe(f.session.id, check);
    check();
  });
}

export async function agentsIdle(f: AgentFixture): Promise<void> {
  await agentChanged(
    f,
    () => f.runtime.getSnapshot(f.session.id).session.activeRunId === null,
    'root execution did not settle',
  );
  await f.runtime.cancel(f.session.id);
}
