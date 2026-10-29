import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { SessionSummary } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import type { EventInput } from '../src/sessions/ports.js';
import { RuntimeError } from '../src/errors.js';
import { ModelApprovalReviewer, type ApprovalReviewInput } from '../src/tools/approval-review.js';

const session: SessionSummary = {
  id: 'session',
  title: 'Guarded review',
  providerId: 'provider',
  modelId: 'model',
  thinkingLevel: 'off',
  workspaceId: 'workspace',
  approvalMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  activeBranchId: 'main',
  activeRunId: 'run',
  snapshotSeq: 1,
};

function fixture() {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  const events: EventInput[] = [];
  let acquired = 0;
  let released = 0;
  let unguarded = 0;
  const reviewer = new ModelApprovalReviewer({
    gateway: {
      resolve: () => {
        acquired += 1;
        return Promise.resolve({
          model: faux.models[0],
          streamFn: () => {
            unguarded += 1;
            throw new Error('The owning Run guard must admit this request');
          },
          release: () => {
            released += 1;
          },
        });
      },
    },
    context: () => ({ userRequests: [{ text: 'Create report.txt with the requested result.' }] }),
  });
  const input: ApprovalReviewInput = {
    session,
    runId: 'run',
    tool: {
      id: 'tool',
      name: 'write_file',
      arguments: { path: 'report.txt', content: 'requested result', expectedHash: null },
      summary: 'Create report.txt',
    },
    commit: (records) => {
      events.push(...records);
    },
  };
  return {
    faux,
    models,
    reviewer,
    input,
    events,
    leases: () => ({ acquired, released, unguarded }),
  };
}

describe('AI approval model admission', () => {
  it('uses the owning Run stream guard while retaining and releasing the isolated reviewer lease', async () => {
    const f = fixture();
    let guarded = 0;
    f.faux.setResponses([
      fauxAssistantMessage('{"decision":"allow","reason":"Matches the recorded request."}'),
    ]);
    const stream: StreamFn = (model, context, options) => {
      guarded += 1;
      expect(options?.maxTokens).toBe(Math.min(1024, model.maxTokens));
      expect(
        context.messages.flatMap((message) =>
          message.role === 'system' ? (message.toolsAdded ?? []) : [],
        ),
      ).toEqual([]);
      return f.models.streamSimple(model, context, options);
    };
    const verdict = await f.reviewer.review(
      { ...f.input, modelStream: stream },
      new AbortController().signal,
    );
    expect(verdict).toEqual({ decision: 'allow', reason: 'Matches the recorded request.' });
    expect(guarded).toBe(1);
    expect(f.leases()).toEqual({ acquired: 1, released: 1, unguarded: 0 });
    expect(f.events.map((event) => event.type)).toEqual([
      'tool.review.requested',
      'tool.review.completed',
    ]);
  });

  it('requires human approval and releases the review lease when the Run guard refuses a request', async () => {
    const f = fixture();
    let guarded = 0;
    const stream: StreamFn = () => {
      guarded += 1;
      return Promise.reject(new RuntimeError('AGENT_BUDGET', 'No request budget remains'));
    };
    const verdict = await f.reviewer.review(
      { ...f.input, modelStream: stream },
      new AbortController().signal,
    );
    expect(verdict.decision).toBe('ask');
    expect(guarded).toBe(1);
    expect(f.leases()).toEqual({ acquired: 1, released: 1, unguarded: 0 });
    expect(f.events.at(-1)).toMatchObject({
      type: 'tool.review.completed',
      data: { decision: 'ask' },
    });
  });
});
