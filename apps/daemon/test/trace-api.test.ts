import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionUsageSchema,
  TracePageSchema,
  type RunView,
  type TracePage,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/application/config';
import { createApplicationServices } from '../src/application/services';
import { createDaemonApplication, type DaemonApplication } from '../src/http/server';
import { loginFixture } from './support/login';

const fixtures: { directory: string; application: DaemonApplication }[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-trace-api-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
  });
  let application: DaemonApplication | undefined;
  try {
    application = await createDaemonApplication(config, undefined, services);
    const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
    fixtures.push({ directory, application });
    const login = await loginFixture(origin, services);
    const headers = { Origin: origin, Cookie: login.cookie };
    services.store.createSession({
      id: 'session',
      branchId: 'main',
      title: 'Trace',
      providerId: 'fixture',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: 1,
    });
    const run: RunView = {
      id: 'run',
      sessionId: 'session',
      branchId: 'main',
      providerId: 'fixture',
      modelId: 'model',
      status: 'running',
      createdAt: 2,
      finishedAt: null,
      error: null,
    };
    services.store.append('session', [
      {
        type: 'run.accepted',
        runId: 'run',
        at: 2,
        data: { run, requestId: 'input-request' },
      },
    ]);
    const appendRequest = (modelRequestId: string, at: number): void => {
      services.store.append('session', [
        {
          type: 'model.request.started',
          runId: 'run',
          at,
          data: {
            modelRequestId,
            branchId: 'main',
            purpose: 'conversation',
            inputMessageId: null,
            answerInputMessageId: null,
            providerId: 'fixture',
            modelId: 'model',
            queuedAt: at,
            startedAt: at,
          },
          privateData: { credential: 'private-fixture-secret' },
        },
      ]);
    };
    const send = async (path: string): Promise<Response> =>
      await fetch(`${origin}${path}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
    return { services, origin, headers, send, appendRequest };
  } catch (error) {
    if (application) await application.server.close();
    else await services.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function trace(response: Response): Promise<TracePage> {
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (!Value.Check(TracePageSchema, value)) throw new Error('Invalid trace response');
  return value;
}

afterEach(async () => {
  for (const { directory, application } of fixtures.splice(0)) {
    try {
      await application.server.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe('protected execution trace HTTP', () => {
  it('aggregates reported request usage and keeps unfinished or unpriced requests unknown', async () => {
    const value = await fixture();
    value.appendRequest('usage-one', 3);
    const tokens = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 90,
      cacheWriteTokens: 0,
      totalTokens: 120,
    };
    value.services.store.append('session', [
      {
        type: 'model.request.completed',
        runId: 'run',
        at: 8,
        data: {
          modelRequestId: 'usage-one',
          status: 'completed',
          finishedAt: 8,
          durationMs: 5,
          firstResponseMs: 1,
          usage: tokens,
          error: null,
        },
      },
    ]);
    value.appendRequest('usage-two', 9);
    const response = await value.send('/api/sessions/session/usage?includeDescendants=true');
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(Value.Check(SessionUsageSchema, body)).toBe(true);
    expect(body).toMatchObject({
      requestCount: 2,
      recordedRequests: 1,
      unknownRequests: 1,
      tokens,
      modelDurationMs: 5,
      estimatedCostUsd: null,
      unknownPriceRequests: 2,
    });
    expect((await value.send('/api/sessions/session/usage?includeDescendants=1')).status).toBe(400);
    expect((await value.send('/api/sessions/session/usage?owner=other')).status).toBe(400);
    expect((await value.send('/api/sessions/missing/usage')).status).toBe(404);
  });

  it('reads committed request metadata with a frozen cursor and excludes private data', async () => {
    const value = await fixture();
    value.appendRequest('request-one', 3);
    const first = await trace(await value.send('/api/sessions/session/trace?limit=1&kind=request'));
    expect(first.items).toEqual([expect.objectContaining({ modelRequestId: 'request-one' })]);
    expect(JSON.stringify(first)).not.toContain('private-fixture-secret');
    value.services.store.append('session', [
      {
        type: 'model.request.completed',
        runId: 'run',
        at: 4,
        data: {
          modelRequestId: 'request-one',
          status: 'completed',
          finishedAt: 4,
          durationMs: 1,
          firstResponseMs: null,
          error: null,
        },
      },
    ]);
    value.appendRequest('request-two', 4);
    const frozen = await trace(
      await value.send(`/api/sessions/session/trace?kind=request&watermark=${first.watermark}`),
    );
    expect(frozen.items.map((item) => item.modelRequestId)).toEqual(['request-one']);
    expect(frozen.items[0]?.status).toBe('running');
    const fresh = await trace(await value.send('/api/sessions/session/trace?kind=request'));
    expect(fresh.items.map((item) => item.modelRequestId)).toEqual(['request-one', 'request-two']);
    expect(fresh.items[0]?.status).toBe('completed');
  });

  it('rejects invalid pages, unknown fields and inaccessible anchors through real HTTP', async () => {
    const value = await fixture();
    for (const query of [
      'limit=0',
      'limit=201',
      'cursor=-1',
      'watermark=1e4',
      'owner=other',
      'includeDescendants=maybe',
    ]) {
      expect((await value.send(`/api/sessions/session/trace?${query}`)).status).toBe(400);
    }
    expect((await value.send('/api/sessions/missing/trace')).status).toBe(404);
    expect((await value.send('/api/sessions/session/trace/requests/missing')).status).toBe(404);
    expect((await value.send('/api/sessions/session/trace/entries/missing')).status).toBe(404);
    expect(
      (await value.send('/api/sessions/session/trace/requests/missing?offset=-1')).status,
    ).toBe(400);
    expect((await value.send('/api/sessions/session/trace/requests/missing?limit=51')).status).toBe(
      400,
    );
    const anonymous = await fetch(`${value.origin}/api/sessions/session/trace`, {
      headers: { Origin: value.origin },
      signal: AbortSignal.timeout(5000),
    });
    expect(anonymous.status).toBe(401);
  });
});
