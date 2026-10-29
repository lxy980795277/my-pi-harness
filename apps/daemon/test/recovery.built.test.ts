import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuthStatusSchema,
  AttachmentSchema,
  AttachmentContentSchema,
  WorkSnapshotSchema,
  DaemonReadyRecordSchema,
  SessionStreamUpdateSchema,
  ProviderConfigSchema,
  SessionSnapshotSchema,
  type SessionSnapshot,
} from '@my-pi-harness/protocol';
import { sessionLogDirectory, SessionBatchSchema } from '@my-pi-harness/storage';
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { loginThroughHttp } from './support/login-http.js';
import type { FixtureAuthorization } from './support/login.js';

interface Outcome {
  code: number | null;
  signal: NodeJS.Signals | null;
}
interface Daemon {
  child: ChildProcess;
  origin: string;
  cookie: string;
  csrf: string;
  exited: Promise<Outcome>;
  stop(): Promise<Outcome>;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const launcher = fileURLToPath(new URL('../../../tests/e2e/start-daemon.mjs', import.meta.url));
const JSON_OBJECT_SCHEMA = Type.Record(Type.String(), Type.Unknown());

function checked<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) throw new Error('Invalid built daemon response');
  return value;
}

async function deadline<T>(task: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function startDaemon(
  profile: string,
  children: ChildProcess[],
  previous?: FixtureAuthorization,
): Promise<Daemon> {
  const secret = randomBytes(32).toString('base64url');
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: profile,
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(profile, '.my-pi-harness'),
    MY_PI_HARNESS_DESKTOP_SECRET: secret,
  };
  for (const name of [
    'NODE_OPTIONS',
    'MY_PI_HARNESS_WEB_DIST_PATH',
    'MY_PI_HARNESS_DEVELOPMENT_ORIGIN',
    'MY_PI_HARNESS_PARENT_PID',
    'MY_PI_HARNESS_GITHUB_CLIENT_ID',
    'MY_PI_HARNESS_GITHUB_CLIENT_SECRET',
  ])
    delete environment[name];
  environment.MY_PI_HARNESS_GITHUB_CLIENT_ID = 'synthetic-built-client-id';
  // The artifact fixture injects credentials and GitHub responses; production bootstrap does neither.
  const child = spawn(process.execPath, [launcher], {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  const exited = new Promise<Outcome>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  let diagnostics = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostics = `${diagnostics}${chunk.toString()}`.slice(-16_384);
  });
  const ready = await deadline(
    new Promise<Static<typeof DaemonReadyRecordSchema>>((resolve, reject) => {
      let pending = '';
      const cleanup = (): void => {
        child.stdout?.off('data', receive);
        child.off('error', failed);
        child.off('exit', earlyExit);
      };
      const failed = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const earlyExit = (): void =>
        failed(new Error(`Recovery fixture exited before readiness: ${diagnostics}`));
      const receive = (chunk: Buffer): void => {
        pending += chunk.toString();
        if (pending.length > 64 * 1024) {
          failed(new Error('Oversized readiness record'));
          return;
        }
        const newline = pending.indexOf('\n');
        if (newline === -1) return;
        try {
          const value: unknown = JSON.parse(pending.slice(0, newline));
          const record = checked(DaemonReadyRecordSchema, value);
          cleanup();
          resolve(record);
        } catch (error) {
          failed(error instanceof Error ? error : new Error('Invalid readiness JSON'));
        }
      };
      child.stdout?.on('data', receive);
      child.once('error', failed);
      child.once('exit', earlyExit);
    }),
    'Built daemon did not become ready',
  );
  const origin = `http://${ready.host}:${ready.port}`;
  const bootstrap = await fetch(`${origin}/api/auth/desktop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(previous ? { Cookie: previous.cookie } : {}),
    },
    body: JSON.stringify({ secret }),
    signal: AbortSignal.timeout(5000),
  });
  const localCookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
  await bootstrap.body?.cancel();
  if (!bootstrap.ok || !localCookie) throw new Error('Artifact owner authorization failed');
  const retained =
    previous?.cookie
      .split(';')
      .map((pair) => pair.trim())
      .filter((pair) => !pair.startsWith('my_pi_local=')) ?? [];
  const cookie = [localCookie, ...retained].join('; ');
  const response = await fetch(`${origin}/api/auth/status`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(5000),
  });
  const status: unknown = await response.json();
  const authorization = checked(AuthStatusSchema, status);
  const csrf = authorization.csrfToken;
  if (!response.ok || !csrf || !authorization.localAuthorized)
    throw new Error('Artifact owner has no local trust');
  let granted: FixtureAuthorization;
  if (previous) {
    expect(authorization.authenticated).toBe(true);
    granted = { cookie, csrf };
  } else {
    expect(authorization.authenticated).toBe(false);
    const privateRead = await fetch(`${origin}/api/providers`, { headers: { Cookie: cookie } });
    expect(privateRead.status).toBe(401);
    await privateRead.body?.cancel();
    granted = await loginThroughHttp(origin, { cookie, csrf });
  }
  let stopping: Promise<Outcome> | undefined;
  return {
    child,
    origin,
    cookie: granted.cookie,
    csrf: granted.csrf,
    exited,
    stop: () =>
      (stopping ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return exited;
        if (child.connected) child.send({ type: 'daemon.shutdown' }, () => undefined);
        else child.kill('SIGTERM');
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 5000);
        try {
          return await deadline(exited, 'Built daemon did not exit');
        } finally {
          clearTimeout(timer);
        }
      })()),
  };
}

async function api<T extends TSchema>(
  daemon: Daemon,
  path: string,
  schema: T,
  method = 'GET',
  body?: unknown,
): Promise<Static<T>> {
  const response = await fetch(`${daemon.origin}/api${path}`, {
    method,
    headers: {
      Cookie: daemon.cookie,
      Origin: daemon.origin,
      'X-CSRF-Token': daemon.csrf,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(value)}`);
  return checked(schema, value);
}

async function waitSnapshot(
  daemon: Daemon,
  sessionId: string,
  predicate: (snapshot: SessionSnapshot) => boolean,
): Promise<SessionSnapshot> {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const snapshot = await api(daemon, `/sessions/${sessionId}`, SessionSnapshotSchema);
    if (predicate(snapshot)) return snapshot;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected durable session projection was not observed');
}

async function bodyText(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) throw new Error('Unexpected HTTP body bytes');
    body += chunk.toString();
  }
  return body;
}

async function providerFixture(): Promise<{ server: Server; baseUrl: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    void bodyText(request)
      .then((body) => {
        requests.push(body);
        const number = requests.length;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (delta: object, finish: string | null): void => {
          response.write(
            `data: ${JSON.stringify({ id: `fixture-${number}`, object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
          );
        };
        chunk({ role: 'assistant' }, null);
        chunk({ content: `durable partial ${number}` }, null);
        if (number !== 1 && number !== 3) {
          chunk({}, 'stop');
          response.end('data: [DONE]\n\n');
        }
      })
      .catch(() => {
        response.destroy();
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Provider has no TCP address');
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

async function readStreamSnapshot(daemon: Daemon, sessionId: string): Promise<SessionSnapshot> {
  const response = await fetch(`${daemon.origin}/api/sessions/${sessionId}/events`, {
    headers: { Cookie: daemon.cookie },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.body) throw new Error('Authorized replay failed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Replay ended before its snapshot');
      if (!(chunk.value instanceof Uint8Array)) throw new Error('Replay returned non-byte data');
      pending += decoder.decode(chunk.value, { stream: true });
      let end = pending.indexOf('\n\n');
      while (end !== -1) {
        const record = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const eventName = /^event: (.+)$/m.exec(record)?.[1];
        const data = /^data: (.+)$/m.exec(record)?.[1];
        if (data) {
          const value: unknown = JSON.parse(data);
          if (eventName !== 'session.update') throw new Error('Unexpected session stream event');
          const update = checked(SessionStreamUpdateSchema, value);
          if (update.kind !== 'snapshot')
            throw new Error('Reconnect did not start with a baseline');
          return update.snapshot;
        }
        end = pending.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel();
  }
}

describe('built daemon recovery with real Pi HTTP streaming', () => {
  it('keeps stopped queues paused, recovers a killed run, replays facts and resumes only on explicit command', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'my-pi-built-recovery-'));
    const children: ChildProcess[] = [];
    const daemons: Daemon[] = [];
    let provider: Awaited<ReturnType<typeof providerFixture>> | undefined;
    try {
      provider = await providerFixture();
      const first = await startDaemon(profile, children);
      daemons.push(first);
      await api(first, '/providers', ProviderConfigSchema, 'POST', {
        id: 'recovery-provider',
        name: 'Synthetic local provider',
        kind: 'custom',
        requiresApiKey: true,
        builtinId: null,
        api: 'openai-completions',
        baseUrl: provider.baseUrl,
        enabled: true,
        models: [
          {
            id: 'fixture-model',
            name: 'Fixture model',
            api: 'openai-completions',
            contextWindow: 8192,
            maxTokens: 1024,
            reasoning: false,
            input: ['text'],
          },
        ],
      });
      await api(first, '/providers/recovery-provider/key', ProviderConfigSchema, 'POST', {
        key: 'synthetic-key-first-process',
      });
      const initial = await api(first, '/sessions', SessionSnapshotSchema, 'POST', {
        title: 'Process recovery',
        providerId: 'recovery-provider',
        modelId: 'fixture-model',
        thinkingLevel: 'off',
      });
      const sessionId = initial.session.id;
      const send = (
        daemon: Daemon,
        text: string,
        requestId: string,
        mode = 'send',
      ): Promise<SessionSnapshot> =>
        api(daemon, `/sessions/${sessionId}/inputs`, SessionSnapshotSchema, 'POST', {
          text,
          requestId,
          mode,
        });
      await send(first, 'Initial request', 'initial');
      await waitSnapshot(first, sessionId, (snapshot) =>
        snapshot.messages.some(({ text }) => text === 'durable partial 1'),
      );
      await send(first, 'Keep me pending after stop', 'paused-follow-up', 'follow-up');
      const stopped = await api(
        first,
        `/sessions/${sessionId}/stop`,
        SessionSnapshotSchema,
        'POST',
        {},
      );
      expect(stopped.session.activeRunId).toBeNull();
      expect(stopped.runs[0]?.status).toBe('cancelled');
      expect(stopped.messages).toContainEqual(
        expect.objectContaining({ text: 'durable partial 1', status: 'cancelled' }),
      );
      expect(stopped.queue.map(({ text }) => text)).toEqual(['Keep me pending after stop']);
      expect(provider.requests).toHaveLength(1);

      await send(first, 'Independent new request', 'new-after-stop');
      const completed = await waitSnapshot(
        first,
        sessionId,
        (snapshot) => snapshot.session.activeRunId === null && snapshot.runs.length === 2,
      );
      expect(completed.runs.filter(({ status }) => status === 'completed')).toHaveLength(1);
      expect(completed.messages).toContainEqual(
        expect.objectContaining({
          role: 'assistant',
          text: 'durable partial 2',
          status: 'complete',
          stopReason: 'stop',
        }),
      );
      expect(completed.queue).toHaveLength(1);
      expect(provider.requests).toHaveLength(2);
      expect(provider.requests[1]).toContain('Independent new request');
      expect(provider.requests[1]).not.toContain('Keep me pending after stop');
      await send(first, 'Request killed during streaming', 'crash');
      const streaming = await waitSnapshot(first, sessionId, (snapshot) =>
        snapshot.messages.some(({ text }) => text === 'durable partial 3'),
      );
      expect(streaming.liveRevision).toBeGreaterThan(0);
      const interrupted = streaming.messages.find(({ text }) => text === 'durable partial 3');
      if (!interrupted || interrupted.status !== 'streaming')
        throw new Error('Expected an unfinished assistant before killing the daemon');
      const beforeKill = await send(
        first,
        'Keep me pending after crash',
        'crash-follow-up',
        'follow-up',
      );
      expect(beforeKill.queue).toHaveLength(2);
      first.child.kill('SIGKILL');
      const killed = await deadline(first.exited, 'Killed daemon remained alive');
      expect(killed.code !== 0 || killed.signal !== null).toBe(true);

      const second = await startDaemon(profile, children, first);
      daemons.push(second);
      const restored = await api(second, `/sessions/${sessionId}`, SessionSnapshotSchema);
      expect(restored.session.activeRunId).toBeNull();
      expect(restored.runs).toHaveLength(3);
      expect(restored.runs.filter(({ status }) => status === 'interrupted')).toHaveLength(1);
      expect(restored.messages).toContainEqual(
        expect.objectContaining({
          id: interrupted.id,
          text: '',
          thinking: '',
          status: 'interrupted',
        }),
      );
      for (const message of completed.messages)
        expect(restored.messages.find(({ id }) => id === message.id)).toEqual(message);
      expect(restored.queue.map(({ text }) => text)).toEqual([
        'Keep me pending after stop',
        'Keep me pending after crash',
      ]);
      expect(restored.snapshotSeq).toBe(beforeKill.snapshotSeq + 1);
      expect(restored.liveRevision).toBe(0);
      expect(provider.requests).toHaveLength(3);
      const replayed = await readStreamSnapshot(second, sessionId);
      expect(replayed).toEqual(restored);
      const recoveredLog = join(
        sessionLogDirectory(await realpath(profile), join(profile, '.my-pi-harness')),
        `${sessionId}.jsonl`,
      );
      const recoveredJsonl = await readFile(recoveredLog, 'utf8');
      expect(recoveredJsonl).not.toContain('durable partial 3');
      const recoveredLines = recoveredJsonl.trimEnd().split('\n');
      const recoveredEvents = recoveredLines.flatMap((line) => {
        const value: unknown = JSON.parse(line);
        return checked(SessionBatchSchema, value).records.map((record) => record.event);
      });
      expect(recoveredEvents.map(({ seq }) => seq)).toEqual(
        Array.from({ length: restored.snapshotSeq }, (_value, index) => index + 1),
      );
      expect(recoveredEvents.at(-1)).toMatchObject({
        type: 'run.finished',
        data: { status: 'interrupted' },
      });
      expect(recoveredEvents.some(({ type }) => type === 'message.delta')).toBe(false);
      expect(JSON.stringify(replayed)).not.toContain('synthetic-key');
      expect(JSON.stringify(replayed)).not.toContain('privateData');
      await api(second, '/providers/recovery-provider/key', ProviderConfigSchema, 'POST', {
        key: 'synthetic-key-second-process',
      });
      expect(
        (await api(second, `/sessions/${sessionId}`, SessionSnapshotSchema)).runs,
      ).toHaveLength(3);
      expect(provider.requests).toHaveLength(3);
      await api(second, `/sessions/${sessionId}/queue/resume`, SessionSnapshotSchema, 'POST', {});
      const resumed = await waitSnapshot(
        second,
        sessionId,
        (snapshot) => snapshot.session.activeRunId === null && snapshot.queue.length === 0,
      );
      expect(resumed.runs).toHaveLength(4);
      expect(resumed.runs.filter(({ status }) => status === 'completed')).toHaveLength(2);
      expect(resumed.messages.find(({ id }) => id === interrupted.id)).toMatchObject({
        text: '',
        thinking: '',
        status: 'interrupted',
      });
      for (const number of [2, 4, 5])
        expect(resumed.messages).toContainEqual(
          expect.objectContaining({
            role: 'assistant',
            text: `durable partial ${number}`,
            status: 'complete',
            stopReason: 'stop',
          }),
        );
      expect(provider.requests).toHaveLength(5);
      expect(
        resumed.messages.filter(({ role }) => role === 'user').map(({ text }) => text),
      ).toEqual([
        'Initial request',
        'Independent new request',
        'Request killed during streaming',
        'Keep me pending after stop',
        'Keep me pending after crash',
      ]);
      const retry = await send(
        second,
        'Keep me pending after stop',
        'paused-follow-up',
        'follow-up',
      );
      expect(retry.snapshotSeq).toBe(resumed.snapshotSeq);
      expect(provider.requests).toHaveLength(5);
      expect(await second.stop()).toEqual({ code: 0, signal: null });
    } finally {
      for (const daemon of daemons) await daemon.stop();
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill('SIGKILL');
          await deadline(exited, 'Fixture cleanup did not stop a child');
        }
      const ownedProvider = provider;
      if (ownedProvider)
        await new Promise<void>((resolve, reject) => {
          ownedProvider.server.close((error) => (error ? reject(error) : resolve()));
          ownedProvider.server.closeAllConnections();
        });
      await rm(profile, { recursive: true, force: true });
    }
  }, 45_000);
});

describe('built daemon M3 work recovery', () => {
  it('preserves frozen attachments, tasks and restored session snapshot branches while replaying retired journal fields', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'my-pi-built-work-recovery-'));
    const children: ChildProcess[] = [];
    const daemons: Daemon[] = [];
    let provider: Awaited<ReturnType<typeof providerFixture>> | undefined;
    try {
      provider = await providerFixture();
      const first = await startDaemon(profile, children);
      daemons.push(first);
      await api(first, '/providers', ProviderConfigSchema, 'POST', {
        id: 'work-recovery-provider',
        name: 'Synthetic local work provider',
        kind: 'custom',
        requiresApiKey: false,
        builtinId: null,
        api: 'openai-completions',
        baseUrl: provider.baseUrl,
        enabled: true,
        models: [
          {
            id: 'fixture-model',
            name: 'Fixture model',
            api: 'openai-completions',
            contextWindow: 8192,
            maxTokens: 1024,
            reasoning: false,
            input: ['text'],
          },
        ],
      });
      const initial = await api(first, '/sessions', SessionSnapshotSchema, 'POST', {
        title: 'M3 persisted work',
        providerId: 'work-recovery-provider',
        modelId: 'fixture-model',
        thinkingLevel: 'off',
      });
      const sessionId = initial.session.id;
      const originalBranchId = initial.session.activeBranchId;
      const readWork = (daemon: Daemon, branchId: string) =>
        api(
          daemon,
          `/sessions/${sessionId}/work?branchId=${encodeURIComponent(branchId)}`,
          WorkSnapshotSchema,
        );
      const frozenText = 'Frozen project context: preserve the original goal.\nThe task is local.';
      const attachment = await api(first, '/attachments', AttachmentSchema, 'POST', {
        name: 'context.txt',
        mediaType: 'text/plain',
        data: Buffer.from(frozenText).toString('base64'),
      });
      const initialWork = await readWork(first, originalBranchId);
      expect(initialWork.state).toMatchObject({ revision: 0 });
      const todos = [
        {
          id: 'inspect',
          title: 'Inspect context',
          status: 'pending',
          planStepId: null,
          evidenceToolCallIds: [],
          completionNote: null,
        },
      ];
      await api(first, `/sessions/${sessionId}/work`, WorkSnapshotSchema, 'PATCH', {
        expectedBranchId: originalBranchId,
        revision: initialWork.state.revision,
        todos,
      });
      await api(first, `/sessions/${sessionId}/inputs`, SessionSnapshotSchema, 'POST', {
        text: 'Keep the attached context.',
        attachmentIds: [attachment.id],
        requestId: 'with-attachment',
        mode: 'send',
      });
      await waitSnapshot(first, sessionId, (snapshot) =>
        snapshot.messages.some(({ text }) => text === 'durable partial 1'),
      );
      const stopped = await api(
        first,
        `/sessions/${sessionId}/stop`,
        SessionSnapshotSchema,
        'POST',
        {},
      );
      expect(stopped.messages[0]?.attachmentIds).toEqual([attachment.id]);
      const saved = await api(
        first,
        `/sessions/${sessionId}/work/checkpoints`,
        WorkSnapshotSchema,
        'POST',
        {
          expectedBranchId: originalBranchId,
          label: 'Tasks and context',
        },
      );
      const checkpoint = saved.checkpoints[0];
      if (!checkpoint) throw new Error('Checkpoint was not saved');
      expect(checkpoint.state.plan).toBeNull();
      expect(checkpoint.state.todos).toEqual(todos);
      expect(checkpoint.messageIds).toEqual(stopped.messages.map(({ id }) => id));
      await api(first, `/sessions/${sessionId}/work`, WorkSnapshotSchema, 'PATCH', {
        expectedBranchId: originalBranchId,
        revision: saved.state.revision,
        todos: [
          {
            ...todos[0],
            id: 'inspect',
            title: 'Inspect context',
            status: 'completed',
            completionNote: 'The supplied context was inspected.',
          },
        ],
      });
      await api(first, `/sessions/${sessionId}/inputs`, SessionSnapshotSchema, 'POST', {
        text: 'Continue after the checkpoint.',
        requestId: 'after-checkpoint',
        mode: 'send',
      });
      const laterHistory = await waitSnapshot(
        first,
        sessionId,
        (snapshot) => snapshot.session.activeRunId === null && snapshot.runs.length === 2,
      );
      expect(laterHistory.messages.at(-1)).toMatchObject({
        text: 'durable partial 2',
        status: 'complete',
      });
      const laterWork = await readWork(first, originalBranchId);
      const restoredWork = await api(
        first,
        `/sessions/${sessionId}/work/checkpoints/${checkpoint.id}/restore`,
        WorkSnapshotSchema,
        'POST',
        {
          expectedBranchId: originalBranchId,
          revision: laterWork.state.revision,
        },
      );
      const restoredBranchId = restoredWork.state.branchId;
      expect(restoredBranchId).not.toBe(originalBranchId);
      expect(restoredWork.state).toMatchObject({ plan: null, todos });
      const restoredHistory = await api(first, `/sessions/${sessionId}`, SessionSnapshotSchema);
      expect(restoredHistory.messages).toEqual(stopped.messages);
      expect(restoredHistory.queue).toEqual([]);
      expect(provider.requests).toHaveLength(2);
      expect(provider.requests[0]).toContain(frozenText.split('\n')[0]);
      expect(await first.stop()).toEqual({ code: 0, signal: null });
      const log = join(
        sessionLogDirectory(await realpath(profile), join(profile, '.my-pi-harness')),
        `${sessionId}.jsonl`,
      );
      const currentJsonl = await readFile(log, 'utf8');
      let oldWorkStates = 0;
      let oldCheckpoints = 0;
      const legacyBatches = currentJsonl
        .trimEnd()
        .split('\n')
        .map((line, index) => {
          const batch = checked(SessionBatchSchema, JSON.parse(line) as unknown);
          expect(Object.keys(batch).sort()).toEqual(['checksum', 'records']);
          for (const { event } of batch.records) {
            if (event.type === 'work.updated') {
              checked(JSON_OBJECT_SCHEMA, event.data['state'])['mode'] = 'plan';
              oldWorkStates += 1;
            }
            if (event.type === 'checkpoint.created') {
              const checkpoint = checked(JSON_OBJECT_SCHEMA, event.data['checkpoint']);
              checked(JSON_OBJECT_SCHEMA, checkpoint['state'])['mode'] = 'plan';
              oldCheckpoints += 1;
            }
          }
          const body = {
            version: index % 2 === 0 ? 3 : 4,
            writer: 'retired-work-mode-fixture',
            records: batch.records,
          };
          return {
            ...body,
            checksum: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
          };
        });
      expect(oldWorkStates).toBeGreaterThan(0);
      expect(oldCheckpoints).toBe(1);
      const legacyJsonl = `${legacyBatches.map((batch) => JSON.stringify(batch)).join('\n')}\n`;
      await writeFile(log, legacyJsonl);
      await appendFile(log, '{"records":[{"event":"crash-tail');

      const second = await startDaemon(profile, children, first);
      daemons.push(second);
      const afterRestart = await api(second, `/sessions/${sessionId}`, SessionSnapshotSchema);
      expect(afterRestart).toEqual(restoredHistory);
      const recoveredWork = await readWork(second, restoredBranchId);
      expect(recoveredWork).toEqual(restoredWork);
      expect(recoveredWork.state).not.toHaveProperty('mode');
      for (const savedCheckpoint of recoveredWork.checkpoints)
        expect(savedCheckpoint.state).not.toHaveProperty('mode');
      const content = await api(
        second,
        `/attachments/${attachment.id}/content`,
        AttachmentContentSchema,
      );
      expect(content).toEqual({ attachment, text: frozenText, imageData: null });
      expect(await api(second, `/attachments/${attachment.id}`, AttachmentSchema)).toEqual(
        attachment,
      );
      const replayed = await readStreamSnapshot(second, sessionId);
      const jsonl = await readFile(log, 'utf8');
      expect(jsonl).toBe(legacyJsonl);
      expect(jsonl.endsWith('\n')).toBe(true);
      const diskBatches = jsonl
        .slice(0, -1)
        .split('\n')
        .map((line) => {
          const value: unknown = JSON.parse(line);
          const batch = checked(SessionBatchSchema, value);
          expect(batch).toMatchObject({ writer: 'retired-work-mode-fixture' });
          return batch;
        });
      expect(replayed).toEqual(afterRestart);
      const journalEvents = diskBatches.flatMap((batch) =>
        batch.records.map((record) => record.event),
      );
      expect(journalEvents.map(({ seq }) => seq)).toEqual(
        Array.from({ length: afterRestart.snapshotSeq }, (_value, index) => index + 1),
      );
      expect(
        diskBatches.some((batch) => batch.records.some((record) => record.privateData !== null)),
      ).toBe(true);
      expect(jsonl).not.toContain('crash-tail');
      expect(jsonl).toContain('privateData');
      expect(JSON.stringify(replayed)).not.toContain('privateData');
      expect(jsonl).not.toContain(Buffer.from(frozenText).toString('base64'));

      expect(journalEvents.filter(({ type }) => type === 'checkpoint.created')).toHaveLength(1);
      expect(journalEvents.filter(({ type }) => type === 'branch.restored')).toHaveLength(1);
      expect(journalEvents.some((event) => 'privateData' in event)).toBe(false);
      expect(provider.requests).toHaveLength(2);
      const original = await api(
        second,
        `/sessions/${sessionId}/branches/${originalBranchId}/select`,
        SessionSnapshotSchema,
        'POST',
        {},
      );
      expect(original.messages).toEqual(laterHistory.messages);
      expect((await readWork(second, originalBranchId)).state).toEqual(laterWork.state);
      expect(provider.requests).toHaveLength(2);
      expect(await second.stop()).toEqual({ code: 0, signal: null });
      const appendedJsonl = await readFile(log, 'utf8');
      expect(appendedJsonl.startsWith(legacyJsonl)).toBe(true);
      const newLines = appendedJsonl.slice(legacyJsonl.length).trimEnd().split('\n');
      expect(newLines).toHaveLength(1);
      for (const line of newLines) {
        const batch = checked(SessionBatchSchema, JSON.parse(line) as unknown);
        expect(Object.keys(batch).sort()).toEqual(['checksum', 'records']);
      }
      const third = await startDaemon(profile, children, second);
      daemons.push(third);
      expect(await api(third, `/sessions/${sessionId}`, SessionSnapshotSchema)).toEqual(original);
      expect((await readWork(third, originalBranchId)).state).toEqual(laterWork.state);
      expect(await readFile(log, 'utf8')).toBe(appendedJsonl);
      expect(provider.requests).toHaveLength(2);
      expect(await third.stop()).toEqual({ code: 0, signal: null });
    } finally {
      for (const daemon of daemons) await daemon.stop();
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGKILL');
        await deadline(exited, 'M3 recovery cleanup did not stop a child');
      }
      const ownedProvider = provider;
      if (ownedProvider)
        await new Promise<void>((resolve, reject) => {
          ownedProvider.server.close((error) => (error ? reject(error) : resolve()));
          ownedProvider.server.closeAllConnections();
        });
      await rm(profile, { recursive: true, force: true });
    }
  }, 45_000);
});
