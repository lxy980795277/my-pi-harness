import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { initialWorkState, type ContextSummary } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { summarizeContext } from '../src/context/summary';
import { encodeContextMessage } from '../src/context/codec';
import type { SummaryInput } from '../src/context/types';
import type { EventInput } from '../src/sessions/ports';

const summary: ContextSummary = {
  objective: 'Continue the requested task.',
  constraints: ['Use only observed source records.'],
  decisions: [],
  completed: ['Read the source records.'],
  pending: ['Present a bounded conclusion.'],
  blockers: [],
  nextAction: 'Present the conclusion.',
};

function fixture() {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);
  const events: EventInput[] = [];
  const input: SummaryInput = {
    source: [{ role: 'user', content: 'observed '.repeat(5000), timestamp: 1 }],
    previous: null,
    state: initialWorkState('branch'),
    resolved: {
      model: faux.models[0],
      streamFn: models.streamSimple.bind(models),
      release: () => undefined,
    },
    signal: new AbortController().signal,
    audit: (systemPrompt, user, modelRequestId) => {
      events.push({
        type: 'context.compaction.prepared',
        runId: null,
        at: Date.now(),
        data: { branchId: 'branch', modelRequestId },
        privateData: { version: 1, systemPrompt, messages: [encodeContextMessage(user)] },
      });
    },
    observation: {
      branchId: 'branch',
      runId: null,
      providerId: 'provider',
      purpose: 'compaction',
      inputMessageId: () => null,
      commit: (records) => {
        events.push(...records);
      },
    },
  };
  return { input, events, faux };
}

describe('compaction requests share the durable request lifecycle', () => {
  it('records each actual summary chunk independently, including manual requests without a Run', async () => {
    const f = fixture();
    f.faux.setResponses([
      fauxAssistantMessage(JSON.stringify(summary)),
      fauxAssistantMessage(JSON.stringify(summary)),
    ]);
    expect(await summarizeContext(f.input)).toEqual({ strategy: 'model', structured: summary });
    const started = f.events.filter((event) => event.type === 'model.request.started');
    const audits = f.events.filter((event) => event.type === 'context.compaction.prepared');
    const completed = f.events.filter((event) => event.type === 'model.request.completed');
    expect(started).toHaveLength(2);
    expect(new Set(started.map((event) => event.data.modelRequestId)).size).toBe(2);
    expect(started.every((event) => event.runId === null)).toBe(true);
    expect(started.map((event) => event.data.modelRequestId)).toEqual(
      audits.map((event) => event.data.modelRequestId),
    );
    expect(completed.map((event) => event.data.modelRequestId)).toEqual(
      started.map((event) => event.data.modelRequestId),
    );
    expect(completed.every((event) => event.data.status === 'completed')).toBe(true);
  });

  it('propagates a failed terminal audit instead of returning a fallback summary', async () => {
    const f = fixture();
    const failure = new Error('journal commit failed');
    f.faux.setResponses([fauxAssistantMessage(JSON.stringify(summary))]);
    const observation = f.input.observation;
    if (!observation) throw new Error('Missing request observation');
    await expect(
      summarizeContext({
        ...f.input,
        observation: {
          ...observation,
          commit: (events) => {
            if (events[0]?.type === 'model.request.completed') throw failure;
            observation.commit(events);
          },
        },
      }),
    ).rejects.toBe(failure);
  });
});
