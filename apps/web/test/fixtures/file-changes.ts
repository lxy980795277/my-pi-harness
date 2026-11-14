import type {
  FileChangeBatchReceipt,
  FileChangeSummary,
  ToolCallView,
} from '@my-pi-harness/protocol';

export const fileChangeFixture = (
  overrides: Partial<FileChangeSummary> = {},
): FileChangeSummary => {
  return {
    changeId: 'change-one',
    sessionId: 'session',
    seq: 10,
    workspaceId: 'workspace',
    path: 'docs/test.md',
    branchId: 'branch',
    runId: 'run',
    taskId: null,
    toolCallId: 'tool',
    answerInputMessageId: 'input',
    before: { exists: false },
    after: { exists: true, sha256: 'a'.repeat(64), bytes: 10, mode: 0o644 },
    createdAt: 100,
    updatedAt: 110,
    status: 'applied',
    state: 'applied',
    revision: 1,
    local: true,
    undoAvailable: true,
    redoAvailable: false,
    blockedReason: null,
    ...overrides,
  };
};

export const fileBatchFixture = (
  overrides: Partial<FileChangeBatchReceipt> = {},
): FileChangeBatchReceipt => {
  return {
    operationId: 'operation-one',
    action: 'undo',
    status: 'accepted',
    cancelRequested: false,
    createdAt: 200,
    updatedAt: 200,
    finishedAt: null,
    error: null,
    items: [
      {
        changeId: 'change-one',
        path: 'docs/test.md',
        fileOperationId: null,
        status: 'not_started',
        error: null,
      },
    ],
    ...overrides,
  };
};

export const fileToolFixture = (overrides: Partial<ToolCallView> = {}): ToolCallView => {
  return {
    id: 'tool',
    sessionId: 'session',
    runId: 'run',
    branchId: 'branch',
    afterMessageId: 'assistant',
    binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    name: 'write_file',
    arguments: { path: 'docs/test.md', content: 'test', expectedHash: null },
    status: 'completed',
    summary: 'docs/test.md',
    result: 'written',
    diff: null,
    createdAt: 100,
    updatedAt: 110,
    ...overrides,
  };
};
