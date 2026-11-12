import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { observeNativeTool } from './support/native-tool';
import { StoredToolResultSchema } from '@my-pi-harness/protocol/internal';
import { openProfileStore } from '@my-pi-harness/storage';
import { ArrayOptions } from 'typebox/type';
import { describe, expect, it } from 'vitest';
import { decodeContextMessage } from '../src/context/codec';
import { RepeatToolReminder } from '../src/tools/repeat-reminder';
import { agentFixture, agentsIdle, firstTask } from './support/agent-fixture';
import { hasResult, waitForResults } from './support/agent-tools';
import { call, fixture, idle } from './support/work-fixture';

describe('consecutive tool-use reminders', () => {
  it('advises on the third, fifth and eighth exact call without exposing arguments', () => {
    const repeats = new RepeatToolReminder();
    const notices = Array.from({ length: 10 }, () =>
      repeats.observe('web_fetch', { mode: 'raw', url: 'https://private.example/secret-value' }),
    );
    expect(notices.map((notice, index) => (notice ? index + 1 : null)).filter(Boolean)).toEqual([
      3, 5, 8,
    ]);
    for (const notice of notices.filter((value) => value !== undefined)) {
      expect(notice).not.toContain('secret-value');
      expect(notice.length).toBeLessThan(256);
    }
  });

  it('ignores nested object order but preserves array order and resets on another call', () => {
    const repeats = new RepeatToolReminder();
    const first = { query: { right: 2, left: 1 }, pages: [{ z: 0, a: 1 }, 2] };
    const reordered = { pages: [{ a: 1, z: 0 }, 2], query: { left: 1, right: 2 } };
    expect(repeats.observe('read', first)).toBeUndefined();
    expect(repeats.observe('read', reordered)).toBeUndefined();
    expect(repeats.observe('read', first)).toContain('3 times');
    expect(repeats.observe('read', { ...first, pages: [2, { z: 0, a: 1 }] })).toBeUndefined();
    expect(repeats.observe('other', first)).toBeUndefined();
    expect(repeats.observe('read', first)).toBeUndefined();
    expect(repeats.observe('read', first)).toBeUndefined();
    expect(repeats.observe('read', first)).toContain('3 times');
    expect(new RepeatToolReminder().observe('read', first)).toBeUndefined();
  });

  it('retains notices across toolset advances and persists the exact model-visible blocks', async () => {
    const f = await fixture(false);
    let received: TranscriptContext | undefined;
    try {
      f.faux.setResponses([
        call('tool_search', { query: 'web_fetch' }, 'discover-1'),
        fauxAssistantMessage(
          [2, 3].map((index) => ({
            type: 'toolCall' as const,
            id: `discover-${String(index)}`,
            name: 'tool_search',
            arguments: { query: 'web_fetch' },
          })),
          { stopReason: 'toolUse' },
        ),
        (context) => {
          received = context;
          return fauxAssistantMessage('Used the available result.');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Discover web tools without repeated network calls.',
        mode: 'send',
        requestId: 'repeat-discovery',
      });
      await idle(f);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.runs[0]?.status).toBe('completed');
      expect(snapshot.tools.map(({ status }) => status)).toEqual([
        'completed',
        'completed',
        'completed',
      ]);
      const results = received?.messages.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(3);
      const repeated = results?.[2];
      expect(repeated?.isError).toBe(false);
      expect(repeated?.content).toHaveLength(2);
      const original = repeated?.content[0];
      if (original?.type !== 'text') throw new Error('Missing original JSON result');
      expect(() => JSON.parse(original.text) as unknown).not.toThrow();
      const notice = repeated?.content[1];
      if (notice?.type !== 'text') throw new Error('Missing host reminder');
      expect(notice.text).toContain('Host reminder:');
      const retained = f.store
        .getModelContext(f.session.id, snapshot.session.activeBranchId)
        .map(decodeContextMessage)
        .filter((message) => message.role === 'toolResult');
      expect(retained.map(({ content }) => content)).toEqual(
        results?.map(({ content }) => content),
      );
      expect(f.errors).toEqual([]);
      f.work.close();
      await f.runtime.close();
      f.store.close();
      const replayed = await openProfileStore(f.profile);
      try {
        const replayedResults = replayed
          .getModelContext(f.session.id, snapshot.session.activeBranchId)
          .map(decodeContextMessage)
          .filter((message) => message.role === 'toolResult');
        expect(replayedResults.map(({ content }) => content)).toEqual(
          results?.map(({ content }) => content),
        );
      } finally {
        replayed.close();
      }
    } finally {
      await f.close();
    }
  });

  it.each(['failed', 'denied'] as const)('keeps %s outcomes when adding advice', async (status) => {
    const f = await fixture(true);
    let received: TranscriptContext | undefined;
    try {
      if (status === 'denied')
        await f.runtime.updateSession(f.session.id, { approvalMode: 'read-only' });
      f.faux.setResponses([
        fauxAssistantMessage(
          [1, 2, 3].map((index) => ({
            type: 'toolCall' as const,
            id: `missing-${String(index)}`,
            name: status === 'denied' ? 'write_file' : 'read_file',
            arguments:
              status === 'denied'
                ? { path: 'missing.txt', content: 'No write allowed.', expectedHash: null }
                : { path: 'missing.txt' },
          })),
          { stopReason: 'toolUse' },
        ),
        (context) => {
          received = context;
          return fauxAssistantMessage('The requested file is absent.');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Check a missing file.',
        mode: 'send',
        requestId: 'repeat-failure',
      });
      await idle(f);
      expect(f.runtime.getSnapshot(f.session.id).tools.map(({ status }) => status)).toEqual([
        status,
        status,
        status,
      ]);
      const results = received?.messages.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(3);
      expect(results?.every(({ isError }) => isError)).toBe(true);
      expect(results?.[2]?.content[0]).toEqual(results?.[0]?.content[0]);
      const notice = results?.[2]?.content[1];
      if (notice?.type !== 'text') throw new Error('Missing host reminder');
      expect(notice.text).toContain('Host reminder:');
    } finally {
      await f.close();
    }
  });

  it('completes more than 64 tool calls and starts a fresh reminder chain for the next Run', async () => {
    const f = await fixture(true);
    let nextRun: TranscriptContext | undefined;
    try {
      await writeFile(join(f.root, 'source.txt'), 'Retained file body.');
      f.faux.setResponses([
        fauxAssistantMessage(
          Array.from({ length: 65 }, (_, index) => ({
            type: 'toolCall' as const,
            id: `read-${String(index)}`,
            name: 'read_file',
            arguments: { path: 'source.txt' },
          })),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('Finished all 65 reads.'),
        fauxAssistantMessage(
          [1, 2, 3].map((index) => ({
            type: 'toolCall' as const,
            id: `next-run-read-${String(index)}`,
            name: 'read_file',
            arguments: { path: 'source.txt' },
          })),
          { stopReason: 'toolUse' },
        ),
        (context) => {
          nextRun = context;
          return fauxAssistantMessage('Finished a new Run.');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read the same short file 65 times.',
        mode: 'send',
        requestId: 'long-tool-batch',
      });
      await idle(f);
      const first = f.runtime.getSnapshot(f.session.id);
      expect(first.runs[0]?.status).toBe('completed');
      expect(first.tools).toHaveLength(65);
      expect(first.tools.every(({ status }) => status === 'completed')).toBe(true);
      await f.runtime.send(f.session.id, {
        text: 'Read once more in a new Run.',
        mode: 'send',
        requestId: 'fresh-tool-chain',
      });
      await idle(f);
      const results = nextRun?.messages.filter((message) => message.role === 'toolResult');
      const last = results?.at(-1);
      expect(last?.toolCallId).toBe('next-run-read-3');
      expect(results?.slice(-3).map(({ content }) => content.length)).toEqual([1, 1, 2]);
      expect(
        f.runtime.getSnapshot(f.session.id).runs.every(({ status }) => status === 'completed'),
      ).toBe(true);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('keeps three identical spawn receipts readable when the third includes advice', async () => {
    let collected: TranscriptContext | undefined;
    const f = await agentFixture({
      response: (context) => {
        if (firstTask(context) === 'REPEATED_CHILD') return fauxAssistantMessage('Child done.');
        if (!hasResult(context, 'spawn_agent'))
          return fauxAssistantMessage(
            [1, 2, 3].map((index) => ({
              type: 'toolCall' as const,
              id: `spawn-${String(index)}`,
              name: 'spawn_agent',
              arguments: {
                title: 'Repeated child',
                task: 'REPEATED_CHILD',
                roleId: 'researcher',
              },
            })),
            { stopReason: 'toolUse' },
          );
        if (!hasResult(context, 'wait_agents')) {
          collected = context;
          return waitForResults(context);
        }
        return fauxAssistantMessage('Collected all three children.');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_REPEATED_SPAWN',
        mode: 'send',
        requestId: 'repeated-spawn-receipts',
      });
      await agentsIdle(f);
      const receipts = collected?.messages.filter(
        (message) => message.role === 'toolResult' && message.toolName === 'spawn_agent',
      );
      expect(receipts?.map(({ content }) => content.length)).toEqual([1, 1, 2]);
      expect(f.runtime.subagents.list(f.session.id).tasks.map(({ status }) => status)).toEqual([
        'completed',
        'completed',
        'completed',
      ]);
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('preserves a full-capacity result when no separate reminder block fits', async () => {
    const capacity = ArrayOptions(StoredToolResultSchema.properties.content).maxItems;
    if (capacity === undefined) throw new Error('Missing bounded tool content schema');
    const original = Array.from({ length: capacity }, (_, index) => ({
      type: 'text' as const,
      text: `Original block ${String(index)}`,
    }));
    const f = await fixture(true);
    const observed = observeNativeTool('read_file');
    const execute = observed.execute.mockResolvedValue({
      content: original,
      summary: 'All original blocks returned.',
    });
    let received: TranscriptContext | undefined;
    try {
      f.faux.setResponses([
        fauxAssistantMessage(
          [1, 2, 3].map((index) => ({
            type: 'toolCall' as const,
            id: `full-content-${String(index)}`,
            name: 'read_file',
            arguments: { path: 'full-content.txt' },
          })),
          { stopReason: 'toolUse' },
        ),
        (context) => {
          received = context;
          return fauxAssistantMessage('Received every original block.');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read all returned blocks.',
        mode: 'send',
        requestId: 'full-content-reminder',
      });
      await idle(f);
      expect(execute).toHaveBeenCalledTimes(3);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.runs[0]?.status).toBe('completed');
      expect(snapshot.tools.map(({ status }) => status)).toEqual([
        'completed',
        'completed',
        'completed',
      ]);
      const results = received?.messages.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(3);
      expect(results?.map(({ content }) => content)).toEqual([original, original, original]);
      const retained = f.store
        .getModelContext(f.session.id, snapshot.session.activeBranchId)
        .map(decodeContextMessage)
        .filter((message) => message.role === 'toolResult');
      expect(retained.map(({ content }) => content)).toEqual([original, original, original]);
      expect(f.errors).toEqual([]);
    } finally {
      observed.restore();
      await f.close();
    }
  });
});
