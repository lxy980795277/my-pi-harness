import type { SessionSnapshot, SessionSummary } from '@my-pi-harness/protocol';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  mergeSessionSnapshot,
  retainNewestSnapshot,
} from '../src/features/sessions/queries/projection';

const snapshot = (
  seq: number,
  text: string,
  branchId = 'main',
  sessionId = 'session',
): SessionSnapshot => {
  return {
    session: {
      id: sessionId,
      title: '会话',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      createdAt: 0,
      updatedAt: seq,
      activeBranchId: branchId,
      activeRunId: null,
      snapshotSeq: seq,
    },
    branches: [{ id: branchId, sessionId, parentId: null, forkMessageId: null, createdAt: 0 }],
    messages: [
      {
        id: 'message',
        sessionId,
        branchId,
        runId: 'run',
        role: 'assistant',
        text,
        thinking: '',
        createdAt: 0,
        status: 'complete',
        stopReason: 'stop',
      },
    ],
    runs: [],
    queue: [],
    tools: [],
    snapshotSeq: seq,
  };
};

describe('committed session projection cache', () => {
  it('keeps live content when an earlier HTTP read resolves after the SSE batch', async () => {
    const client = new QueryClient();
    client.setQueryData(['session', 'session'], snapshot(1, '开始'));
    let finishRead: (value: SessionSnapshot) => void = (): void => {
      throw new Error('HTTP read has not started');
    };
    const read = client.query({
      queryKey: ['session', 'session'],
      queryFn: (): Promise<SessionSnapshot> => {
        return new Promise((resolve) => {
          finishRead = resolve;
        });
      },
      structuralSharing: (current, incoming): SessionSnapshot => {
        return retainNewestSnapshot(
          current as SessionSnapshot | undefined,
          incoming as SessionSnapshot,
        );
      },
    });
    mergeSessionSnapshot(client, snapshot(5, '最新流式内容'));
    finishRead(snapshot(2, '旧 HTTP 内容'));
    await read;
    expect(client.getQueryData<SessionSnapshot>(['session', 'session'])?.messages[0]?.text).toBe(
      '最新流式内容',
    );
    expect(client.getQueryData<SessionSnapshot>(['session', 'session'])?.snapshotSeq).toBe(5);
    client.clear();
  });

  it('retains a selected revision branch when an old command response arrives late', () => {
    const client = new QueryClient();
    mergeSessionSnapshot(client, snapshot(12, '修订回复', 'revision'));
    mergeSessionSnapshot(client, snapshot(8, '原分支回复'));
    const current = client.getQueryData<SessionSnapshot>(['session', 'session']);
    expect(current?.session.activeBranchId).toBe('revision');
    expect(current?.messages[0]?.text).toBe('修订回复');
    client.clear();
  });

  it('deduplicates the same committed sequence and preserves its cached reference', () => {
    const current = snapshot(5, '完成');
    expect(retainNewestSnapshot(current, snapshot(5, '重复投递'))).toBe(current);
    expect(retainNewestSnapshot(current, snapshot(4, '重放'))).toBe(current);
  });

  it('does not merge another session into the selected query', () => {
    expect(() => {
      retainNewestSnapshot(snapshot(1, 'A'), snapshot(2, 'B', 'main', 'another'));
    }).toThrow('不能合并不同会话');
  });

  it('keeps unchanged message references while a later streaming row advances', () => {
    const initial = snapshot(1, '相同正文');
    const next = snapshot(2, '相同正文');
    const merged = retainNewestSnapshot(initial, next);
    expect(merged.snapshotSeq).toBe(2);
    expect(merged.messages[0]).toBe(initial.messages[0]);
    expect(merged.branches[0]).toBe(initial.branches[0]);
    expect(merged.session).not.toBe(initial.session);
  });

  it('updates navigation from the same accepted fact without regressing its sequence', () => {
    const client = new QueryClient();
    const initial: SessionSummary[] = [
      snapshot(3, '').session,
      snapshot(1, '', 'main', 'another').session,
    ];
    client.setQueryData(['sessions'], initial);
    mergeSessionSnapshot(client, snapshot(7, '新回复', 'revision'));
    mergeSessionSnapshot(client, snapshot(4, '旧回复'));
    const sessions = client.getQueryData<SessionSummary[]>(['sessions']);
    expect(sessions?.[0]?.snapshotSeq).toBe(7);
    expect(sessions?.[0]?.activeBranchId).toBe('revision');
    expect(sessions?.[1]).toEqual(initial[1]);
    client.clear();
  });
});
