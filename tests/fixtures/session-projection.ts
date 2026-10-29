import type { MessageView, SessionSnapshot } from '@my-pi-harness/protocol';

/** Deterministic public facts for transport and projection tests without a model or filesystem. */
export const sessionProjection = (seq = 1, text = 'initial', liveRevision = 0): SessionSnapshot => {
  return {
    session: {
      id: 'session',
      title: 'Conversation',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      createdAt: 1,
      updatedAt: seq,
      activeBranchId: 'main',
      activeRunId: 'run',
      snapshotSeq: seq,
    },
    branches: [
      { id: 'main', sessionId: 'session', parentId: null, forkMessageId: null, createdAt: 1 },
    ],
    messages: [
      {
        id: 'user',
        sessionId: 'session',
        branchId: 'main',
        runId: 'run',
        role: 'user',
        text: 'Request',
        thinking: '',
        createdAt: 1,
        status: 'complete',
        stopReason: null,
      },
      {
        id: 'assistant',
        sessionId: 'session',
        branchId: 'main',
        runId: 'run',
        role: 'assistant',
        text,
        thinking: '',
        createdAt: 2,
        status: 'streaming',
        stopReason: null,
      },
    ],
    runs: [
      {
        id: 'run',
        sessionId: 'session',
        branchId: 'main',
        providerId: 'provider',
        modelId: 'model',
        status: 'running',
        createdAt: 1,
        finishedAt: null,
        error: null,
      },
    ],
    queue: [],
    tools: [],
    snapshotSeq: seq,
    liveRevision,
  };
};

/** Selects a known fixture message with an explicit missing-id failure. */
export const projectionMessage = (snapshot: SessionSnapshot, id = 'assistant'): MessageView => {
  const message = snapshot.messages.find((item) => item.id === id);
  if (!message) throw new Error('Missing projection fixture message');
  return message;
};
