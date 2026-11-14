import { SESSION_ARCHIVE_MAXIMUM_UPLOAD_BYTES } from '@my-pi-harness/protocol';

export const ARCHIVE_LIMITS = {
  compressedBytes: SESSION_ARCHIVE_MAXIMUM_UPLOAD_BYTES,
  expandedBytes: 512 * 1024 * 1024,
  journalBytes: 384 * 1024 * 1024,
  resourceBytes: 32 * 1024 * 1024,
  manifestBytes: 8 * 1024 * 1024,
  entries: 10000,
  operationMs: 300000,
  retainedJobs: 100,
  retainedExports: 2,
  concurrentJobs: 2,
  concurrentDownloads: 4,
} as const;
