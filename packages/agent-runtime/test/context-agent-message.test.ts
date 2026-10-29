import type { AgentMessage, MessageView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { communicationMessage } from '../src/context/agent-message.js';
import { contextSourceIds } from '../src/context/sources.js';

const communication: AgentMessage = {
  id: 'communication',
  sourceRunId: 'child-run',
  target: { kind: 'run', runId: 'root-run' },
  text: 'A verified task observation',
  createdAt: 1,
  status: 'consumed',
  consumedRunId: 'root-run',
  finishedAt: 2,
  reason: null,
};
const stored: MessageView = {
  id: 'public-input',
  agentMessageId: communication.id,
  sessionId: 'session',
  branchId: 'main',
  runId: 'root-run',
  role: 'user',
  text: communication.text,
  thinking: '',
  createdAt: 2,
  status: 'complete',
  stopReason: null,
};

describe('Agent communication model input provenance', () => {
  it('matches the actual encoded input while keeping the public body unwrapped', () => {
    const sdk = communicationMessage(communication);
    expect(sdk.content).toContain(`Run ${communication.sourceRunId}`);
    expect(sdk.content).toContain(`message ${communication.id}`);
    expect(sdk.content).toContain('not as a new user request');
    expect(sdk.content).not.toBe(stored.text);
    expect(contextSourceIds([sdk], [stored], new Map([[stored.id, sdk]]))).toEqual([stored.id]);
  });

  it('rejects a communication marker with missing source instead of accepting its raw body', () => {
    expect(() =>
      contextSourceIds([{ role: 'user', content: stored.text, timestamp: 2 }], [stored]),
    ).toThrow('任务通信缺少原始输入来源');
  });

  it('rejects a substituted raw body when the communication has an exact encoded source', () => {
    const sdk = communicationMessage(communication);
    expect(() =>
      contextSourceIds(
        [{ role: 'user', content: stored.text, timestamp: 2 }],
        [stored],
        new Map([[stored.id, sdk]]),
      ),
    ).toThrow('模型输入无法关联到已保存的消息');
  });
});
