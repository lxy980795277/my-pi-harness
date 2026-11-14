import type { SessionArchiveJob, SessionArchivePreview } from '@my-pi-harness/protocol';

export const archivePreviewFixture = (
  overrides: Partial<SessionArchivePreview> = {},
): SessionArchivePreview => {
  return {
    archiveSha256: 'a'.repeat(64),
    canImport: true,
    conflictCount: 0,
    conflicts: [],
    warnings: [],
    manifest: {
      formatVersion: 1,
      sessionId: 'archived-session',
      title: '历史会话',
      snapshotSeq: 10,
      createdAt: 100,
      activeAtSnapshot: true,
      entryCount: 3,
      totalBytes: 120,
      dependencies: {
        providers: [{ providerId: 'old-provider', modelIds: ['old-model'] }],
        workspace: { workspaceId: 'old-workspace', name: '历史工作区' },
        plugins: ['plugin-old'],
      },
    },
    ...overrides,
  };
};

export const archiveJobFixture = (
  overrides: Partial<SessionArchiveJob> = {},
): SessionArchiveJob => {
  return {
    operationId: 'archive-op',
    kind: 'import',
    status: 'ready',
    phase: 'ready',
    bytesProcessed: 120,
    totalBytes: 120,
    archiveSha256: 'a'.repeat(64),
    sessionId: 'archived-session',
    preview: archivePreviewFixture(),
    error: null,
    createdAt: 100,
    updatedAt: 200,
    downloadAvailable: false,
    ...overrides,
  };
};
