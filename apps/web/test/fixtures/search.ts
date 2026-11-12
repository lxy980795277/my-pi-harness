import { createHash } from 'node:crypto';
import type {
  MessageView,
  SearchHit,
  SearchQueryResult,
  SearchSourceSelection,
  SearchSourceWindow,
  SessionSnapshot,
} from '@my-pi-harness/protocol';

export const SOURCE_TEXT = '唯一原文 😀\n下一行 **原始格式**';
export const SOURCE_MESSAGE: MessageView = {
  id: 'source-message',
  sessionId: 'source-session',
  branchId: 'source-branch',
  runId: 'source-run',
  role: 'assistant',
  text: SOURCE_TEXT,
  thinking: '非来源的私有思考',
  createdAt: 1,
  status: 'complete',
  stopReason: 'stop',
};
export const SOURCE_SELECTION: SearchSourceSelection = {
  source: {
    id: 'message:source-message',
    kind: 'message',
    contentHash: createHash('sha256').update(SOURCE_TEXT).digest('hex'),
  },
  target: {
    kind: 'message',
    sessionId: 'source-session',
    branchId: 'source-branch',
    messageId: 'source-message',
  },
  start: 0,
  end: SOURCE_TEXT.length,
};
export const SOURCE_WINDOW: SearchSourceWindow = {
  selection: SOURCE_SELECTION,
  title: '原讨论',
  workspaceId: 'workspace',
  archived: false,
  historicalBranch: false,
  items: [
    {
      ...SOURCE_SELECTION,
      text: SOURCE_TEXT,
      totalLength: SOURCE_TEXT.length,
      origin: 'assistant',
      role: 'assistant',
      status: 'complete',
      createdAt: 1,
    },
  ],
  previous: null,
  next: null,
};
export const SOURCE_HIT: SearchHit = {
  source: SOURCE_SELECTION.source,
  title: '原讨论',
  workspaceId: 'workspace',
  sessionId: 'source-session',
  branchId: 'source-branch',
  messageId: 'source-message',
  origin: 'assistant',
  status: 'complete',
  start: 0,
  end: SOURCE_TEXT.length,
  text: SOURCE_TEXT,
  score: 1,
  createdAt: 1,
};
export const SEARCH_RESULTS: SearchQueryResult = {
  hits: [SOURCE_HIT],
  mode: 'lexical',
  truncated: false,
  generation: 1,
  watermark: 'c'.repeat(64),
};
export const SOURCE_SNAPSHOT: SessionSnapshot = {
  session: {
    id: 'source-session',
    title: '原讨论',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: 'workspace',
    approvalMode: 'full-access',
    createdAt: 1,
    updatedAt: 1,
    activeBranchId: 'source-branch',
    activeRunId: null,
    snapshotSeq: 1,
  },
  branches: [
    {
      id: 'source-branch',
      sessionId: 'source-session',
      parentId: null,
      forkMessageId: null,
      createdAt: 1,
    },
  ],
  messages: [SOURCE_MESSAGE],
  runs: [],
  queue: [],
  tools: [],
  snapshotSeq: 1,
  liveRevision: 0,
};
