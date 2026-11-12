import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MemoryService } from '@my-pi-harness/memory';
import type {
  MemoryMessageSource,
  MemoryEntry,
  MessageView,
  ToolCallRecord,
} from '@my-pi-harness/protocol';
import type { EventInput, MemoryMutationAccess } from '@my-pi-harness/protocol/internal';
import { openProfileStore, type ProfileStore } from '../../src/index';
import { storedToolCallId } from '../../src/sessions/projections/tool-intents';

export interface Fixture {
  directory: string;
  store: ProfileStore;
  memory: MemoryService;
  owner: string;
  next: number;
  source: MemoryMessageSource;
  tools: { tool: ToolCallRecord; anchor: string; call: string }[];
}
const fixtures: Fixture[] = [];

export async function cleanupFixtures(): Promise<void> {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
export function event(
  type: string,
  data: Record<string, unknown>,
  runId: string | null = 'run',
  privateData?: Record<string, unknown>,
): EventInput {
  return { type, data, runId, at: 2, ...(privateData === undefined ? {} : { privateData }) };
}
export function message(
  id: string,
  text: string,
  sessionId = 'session',
  runId: string | null = 'run',
  branchId = 'main',
  role: MessageView['role'] = 'user',
): MessageView {
  return {
    id,
    text,
    sessionId,
    runId,
    branchId,
    role,
    thinking: '',
    createdAt: 2,
    status: 'complete',
    stopReason: role === 'assistant' ? 'toolUse' : null,
  };
}
export function source(message: MessageView): MemoryMessageSource {
  return {
    kind: 'message',
    sessionId: message.sessionId,
    branchId: message.branchId,
    messageId: message.id,
    contentHash: hash(message.text),
  };
}
export function root(
  value: Fixture,
  sessionId = 'session',
  runId = 'run',
  branchId = 'main',
  quotes = false,
  workspaceId: string | null = 'workspace-a',
): MemoryMessageSource {
  value.store.createSession({
    id: sessionId,
    branchId,
    title: 'Direct memory writes',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId,
    approvalMode: 'full-access',
    at: 1,
  });
  const user = message(
    `user-${runId}`,
    'Remember the project details and my preferences.',
    sessionId,
    runId,
    branchId,
  );
  value.store.append(sessionId, [
    event(
      'run.accepted',
      {
        requestId: `request-${runId}`,
        run: {
          id: runId,
          sessionId,
          branchId,
          providerId: 'provider',
          modelId: 'model',
          status: 'running',
          createdAt: 2,
          finishedAt: null,
          error: null,
        },
      },
      runId,
    ),
    event('message.started', user, runId, {
      codecVersion: 1,
      sdkVersion: '1.4.0',
      message: { role: 'user', content: user.text, timestamp: 2 },
      ...(quotes
        ? {
            searchQuotes: [
              {
                source: { id: 'memory:quoted', kind: 'memory', contentHash: hash('Reference') },
                target: { kind: 'memory', memoryId: 'quoted' },
                start: 0,
                end: 9,
              },
            ],
          }
        : {}),
    }),
  ]);
  return source(user);
}
export async function fixture(
  options: { quotes?: boolean; workspace?: boolean } = {},
): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-memory-writes-'));
  const store = await openProfileStore(directory);
  store.auth.createLocalClient({
    id: 'client',
    tokenHash: hash('client'),
    csrfToken: 'csrf',
    createdAt: 1,
    expiresAt: 9999999999999,
  });
  const owner = store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'writes-owner',
      name: 'Fixture',
      avatarUrl: null,
    },
    'client',
    { id: 'login', tokenHash: hash('login'), createdAt: 2, expiresAt: 9999999999999 },
  ).user.id;
  const value: Fixture = {
    directory,
    store,
    owner,
    next: 0,
    source: {
      kind: 'message',
      sessionId: 'session',
      branchId: 'main',
      messageId: 'unset',
      contentHash: hash('unset'),
    },
    tools: [],
    memory: new MemoryService(store.memory),
  };
  for (const id of ['workspace-a', 'workspace-b'])
    store.createWorkspace({
      id,
      name: id,
      icon: 'folder',
      rootPath: join(directory, id),
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  value.source = root(
    value,
    'session',
    'run',
    'main',
    options.quotes,
    options.workspace === false ? null : 'workspace-a',
  );
  value.memory = new MemoryService(store.memory, {
    now: () => 10,
    createId: () => `memory-${++value.next}`,
  });
  fixtures.push(value);
  return value;
}
export function call(
  value: Fixture,
  name: string,
  args: Record<string, unknown>,
  selected = value.source,
): MemoryMutationAccess {
  const index = value.tools.length + 1;
  const anchor = `assistant-${index}`;
  const providerCallId = `call-${index}`;
  const runId = selected.sessionId === 'session' ? 'run' : 'run-b';
  const tool: ToolCallRecord = {
    id: storedToolCallId(runId, anchor, providerCallId),
    sessionId: selected.sessionId,
    branchId: selected.branchId,
    runId,
    name,
    arguments: args,
    binding: { kind: 'accepted', source: { kind: 'session' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status: 'running',
    summary: 'Memory write',
    result: null,
    diff: null,
    createdAt: 2,
    updatedAt: 2,
  };
  value.store.append(selected.sessionId, [
    event(
      'message.started',
      message(anchor, '', selected.sessionId, runId, selected.branchId, 'assistant'),
      runId,
      {
        codecVersion: 1,
        sdkVersion: '1.4.0',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: providerCallId, name, arguments: args }],
          timestamp: 2,
          stopReason: 'toolUse',
        },
      },
    ),
    event('tool.requested', { tool }, runId),
  ]);
  value.tools.push({ tool, anchor, call: providerCallId });
  return {
    ownerUserId: value.owner,
    sessionId: selected.sessionId,
    branchId: selected.branchId,
    runId,
    source: selected,
    toolCallId: tool.id,
  };
}
export function entry(result: ReturnType<MemoryService['create']>): MemoryEntry {
  if (result.entry === null) throw new Error('Expected a surviving memory');
  return result.entry;
}
export function finish(value: Fixture): void {
  const events: EventInput[] = [];
  for (const { tool, anchor, call } of value.tools) {
    events.push(event('tool.updated', { tool: { ...tool, status: 'completed', updatedAt: 3 } }));
    events.push(
      event(
        'tool.context',
        { branchId: 'main', afterMessageId: anchor, toolCallId: tool.id },
        'run',
        {
          toolResultVersion: 1,
          providerCallId: call,
          toolName: tool.name,
          content: [{ type: 'text', text: 'Memory receipt' }],
          isError: false,
          at: 3,
          origin: 'tool',
          outcome: 'completed',
        },
      ),
    );
  }
  events.push(event('run.finished', { status: 'completed', finishedAt: 4, error: null }));
  value.store.append('session', events);
}
export function sql<T>(value: Fixture, operation: (db: Database.Database) => T): T {
  const db = new Database(join(value.directory, 'data.sqlite'));
  try {
    return operation(db);
  } finally {
    db.close();
  }
}
