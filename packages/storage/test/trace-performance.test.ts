import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openProfileStore, sessionLogDirectory } from '../src/index';
import type { EventInput } from '@my-pi-harness/protocol/internal';

const enabled = process.env['MY_PI_HARNESS_TEST_TRACE_PERFORMANCE'] === '1';

/** An opt-in generated journal exercises the real write path and metadata-only trace reads. */
it.skipIf(!enabled)(
  'measures frozen summary pages and direct final-input reads over a generated journal',
  async () => {
    const count = Number(process.env['MY_PI_HARNESS_TEST_TRACE_REQUESTS'] ?? 10000);
    const bodyBytes = Number(
      process.env['MY_PI_HARNESS_TEST_TRACE_BODY_BYTES'] ?? 256 * 1024 * 1024,
    );
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 100_000 ||
      !Number.isSafeInteger(bodyBytes) ||
      bodyBytes < 0 ||
      bodyBytes > 1024 * 1024 * 1024
    )
      throw new Error('Trace performance fixture parameters are invalid');
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-trace-benchmark-')));
    const store = await openProfileStore(directory);
    const generatedAt = performance.now();
    const heapBefore = process.memoryUsage().heapUsed;
    try {
      store.createSession({
        id: 'session',
        branchId: 'main',
        title: 'Trace performance',
        providerId: 'provider',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode: 'ask',
        at: 1,
      });
      store.append('session', [
        {
          type: 'run.accepted',
          runId: 'run',
          at: 2,
          data: {
            requestId: 'input',
            run: {
              id: 'run',
              sessionId: 'session',
              branchId: 'main',
              providerId: 'provider',
              modelId: 'model',
              status: 'running',
              createdAt: 2,
              finishedAt: null,
              error: null,
            },
          },
        },
        {
          type: 'message.started',
          runId: 'run',
          at: 2,
          data: {
            id: 'user',
            sessionId: 'session',
            branchId: 'main',
            runId: 'run',
            role: 'user',
            text: 'Fixture',
            thinking: '',
            createdAt: 2,
            status: 'complete',
            stopReason: null,
          },
        },
      ]);
      const body = 'x'.repeat(Math.ceil(bodyBytes / count));
      const usage = {
        estimatedTokens: 10,
        windowTokens: 100,
        reservedOutput: 20,
        inputBudget: 80,
        trimmedMessages: 0,
        prunedMessages: 0,
        source: 'estimated',
        providerInputTokens: null,
        categories: {
          system: 0,
          rules: 0,
          tools: 0,
          messages: 10,
          attachments: 0,
          summary: 0,
          workingState: 0,
        },
      };
      let lastInputId = 'user';
      for (let index = 0; index < count; index += 1) {
        const modelRequestId = `request-${index}`;
        const startedAt = 10 + index * 10;
        lastInputId = index === 0 ? 'user' : `user-${index}`;
        const events: EventInput[] = [
          {
            type: 'context.prepared',
            runId: 'run',
            at: startedAt,
            data: { modelRequestId, branchId: 'main', usage, messageIds: [lastInputId] },
            privateData: {
              version: 1,
              systemPrompt: 'Benchmark',
              messages: [
                { message: { role: 'system', content: 'Benchmark' } },
                { message: { role: 'user', content: `${body}${index}` } },
              ],
            },
          },
          {
            type: 'model.request.started',
            runId: 'run',
            at: startedAt,
            data: {
              modelRequestId,
              branchId: 'main',
              purpose: 'conversation',
              inputMessageId: lastInputId,
              answerInputMessageId: lastInputId,
              queueDurationMs: 1,
              providerId: 'provider',
              modelId: 'model',
              queuedAt: startedAt - 1,
              startedAt,
            },
          },
          {
            type: 'model.request.completed',
            runId: 'run',
            at: startedAt + 5,
            data: {
              modelRequestId,
              status: 'completed',
              finishedAt: startedAt + 5,
              durationMs: 5,
              firstResponseMs: 1,
              error: null,
            },
          },
        ];
        if (index > 0)
          events.unshift({
            type: 'message.started',
            runId: 'run',
            at: startedAt - 2,
            data: {
              id: lastInputId,
              sessionId: 'session',
              branchId: 'main',
              runId: 'run',
              role: 'user',
              text: `Fixture input ${index}`,
              thinking: '',
              createdAt: startedAt - 2,
              status: 'complete',
              stopReason: null,
            },
          });
        for (let marker = 0; marker < (index === 0 ? 7 : 6); marker += 1)
          events.push({
            type: 'trace.fixture',
            runId: 'run',
            at: startedAt + 5,
            data: { index, marker },
          });
        store.append('session', events);
      }
      store.append('session', [
        {
          type: 'run.finished',
          runId: 'run',
          at: 10 + count * 10,
          data: { status: 'completed', finishedAt: 10 + count * 10, error: null },
        },
      ]);
      const generationMs = performance.now() - generatedAt;
      const durations: number[] = [];
      let maxResponseBytes = 0;
      store.listTrace('session', { limit: 50 });
      for (let sample = 0; sample < 50; sample += 1) {
        const cursor = Math.floor((sample * count) / 50) * 40;
        const start = performance.now();
        const page = store.listTrace('session', { cursor, limit: 50 });
        durations.push(performance.now() - start);
        maxResponseBytes = Math.max(maxResponseBytes, Buffer.byteLength(JSON.stringify(page)));
        expect(page.items.length).toBeLessThanOrEqual(50);
      }
      const usageDurations: number[] = [];
      for (let sample = 0; sample < 50; sample += 1) {
        const start = performance.now();
        const answerUsage = store.getSessionUsage('session', {
          inputMessageId: lastInputId,
          includeDescendants: true,
        });
        usageDurations.push(performance.now() - start);
        expect(answerUsage.requestCount).toBe(1);
      }
      usageDurations.sort((left, right) => left - right);
      const lastAnswerUsageP95Ms = usageDurations[Math.ceil(usageDurations.length * 0.95) - 1];
      expect(lastAnswerUsageP95Ms).toBeLessThanOrEqual(200);
      durations.sort((left, right) => left - right);
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
      expect(p95).toBeLessThanOrEqual(200);
      expect(maxResponseBytes).toBeLessThanOrEqual(256 * 1024);
      const detailStart = performance.now();
      const detail = store.getModelRequest('session', `request-${count - 1}`, {
        cursor: 1,
        limit: 1,
      });
      const detailMs = performance.now() - detailStart;
      expect(detail.items[0]?.text.startsWith('x')).toBe(body.length > 0);
      expect(Buffer.byteLength(JSON.stringify(detail))).toBeLessThanOrEqual(64 * 1024);
      const log = await stat(
        join(sessionLogDirectory(directory, join(directory, '.my-pi-harness')), 'session.jsonl'),
      );
      expect(log.size).toBeGreaterThanOrEqual(bodyBytes);
      process.stdout.write(
        `${JSON.stringify({
          requests: count,
          facts: store.getSession('session')?.snapshotSeq,
          requestedBodyBytes: bodyBytes,
          journalBytes: log.size,
          generationMs,
          warmPage50P95Ms: p95,
          warmLastAnswerUsageP95Ms: lastAnswerUsageP95Ms,
          maxResponseBytes,
          lastRequestDetailMs: detailMs,
          heapGrowthBytes: process.memoryUsage().heapUsed - heapBefore,
        })}\n`,
      );
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);
