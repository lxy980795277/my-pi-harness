import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { SessionArchiveJob, SessionArchiveJobsPage } from '@my-pi-harness/protocol';
import { ArchiveError } from './errors';

export type ArchiveHistoryPosition = Static<typeof positionSchema>;

const positionSchema = Type.Object(
  {
    createdAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    operationId: Type.String({ pattern: '^[A-Za-z0-9_-]{1,160}$' }),
  },
  { additionalProperties: false },
);

export function archiveHistoryPosition(
  cursor: string | undefined,
): ArchiveHistoryPosition | undefined {
  if (cursor === undefined) return undefined;
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    const position: unknown = JSON.parse(bytes.toString('utf8'));
    if (bytes.toString('base64url') !== cursor || !Value.Check(positionSchema, position))
      throw new Error('Invalid cursor');
    return position;
  } catch (cause) {
    throw new ArchiveError('ARCHIVE_QUERY_INVALID', '归档操作读取位置无效，请刷新后重试。', 400, {
      cause,
    });
  }
}

export function archiveHistoryPage(
  jobs: Iterable<SessionArchiveJob>,
  before: ArchiveHistoryPosition | undefined,
  limit: number,
): SessionArchiveJobsPage {
  const rows = [...jobs].filter(
    (job) =>
      before === undefined ||
      job.createdAt < before.createdAt ||
      (job.createdAt === before.createdAt && job.operationId < before.operationId),
  );
  rows.sort(
    (left, right) =>
      right.createdAt - left.createdAt ||
      (left.operationId < right.operationId ? 1 : left.operationId > right.operationId ? -1 : 0),
  );
  const last = rows[limit - 1];
  return {
    items: rows.slice(0, limit).map((job) => ({ ...job, preview: null })),
    nextCursor:
      rows.length > limit && last !== undefined
        ? Buffer.from(
            JSON.stringify({ createdAt: last.createdAt, operationId: last.operationId }),
          ).toString('base64url')
        : null,
  };
}
