import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import {
  ModelRequestDetailQuerySchema,
  TraceQuerySchema,
  ModelRequestDetailSchema,
  TraceEntryDetailSchema,
  TracePageSchema,
  ToolCallRecordSchema,
  type TraceQuery,
  type TracePage,
  type ModelRequestDetail,
  type ModelRequestDetailQuery,
  type TraceEntryDetail,
} from '@my-pi-harness/protocol';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';
import type { SessionJournal } from './session-jsonl';
import { StoredToolResultSchema } from '@my-pi-harness/protocol/internal';
import { TraceProjection, decodeTraceVersion } from './trace-projection';
import { contentPage, requestContent, type TraceContentSource } from './trace-content';
import { executionFilter, latestTraceVersion, traceSession } from './trace-scope';

export interface ModelRequestImage {
  mimeType: string;
  bytes: Uint8Array;
}

const dataRow = Type.Object({ data: Type.String() });
const orderedRow = Type.Object({
  order_seq: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
});
const privateRow = Type.Object({ private_data: Type.String() });
/** Bounded, session-authorized reads over compact versions and journal input anchors. */
export class TraceRepository {
  private readonly projection: TraceProjection;
  public constructor(
    private readonly db: Database.Database,
    private readonly journal: SessionJournal,
  ) {
    this.projection = new TraceProjection(db);
  }

  public list(sessionId: string, input: TraceQuery = {}): TracePage {
    const query = checked(TraceQuerySchema, input);
    const session = traceSession(this.db, sessionId);
    const watermark = query.watermark ?? session.snapshotSeq;
    const cursor = query.cursor ?? 0;
    if (watermark > session.snapshotSeq || cursor > watermark * 4 + 3)
      throw new StorageError('TRACE_QUERY_INVALID', 'Trace cursor exceeds the committed watermark');
    const filter = executionFilter(this.db, sessionId, query);
    if (query.kind !== undefined) {
      filter.sql.push('t.kind=?');
      filter.parameters.push(query.kind);
    }
    if (query.purpose !== undefined) {
      filter.sql.push('t.purpose=?');
      filter.parameters.push(query.purpose);
    }
    if (query.status !== undefined) {
      filter.sql.push('t.status=?');
      filter.parameters.push(query.status);
    }
    const limit = query.limit ?? 50;
    const rows: unknown[] = this.db
      .prepare(
        `SELECT entry, request, order_seq FROM trace_entries t WHERE t.session_id=? AND t.order_seq>? AND t.version_seq<=?
      AND ${latestTraceVersion} ${filter.sql.map((sql) => `AND ${sql}`).join(' ')} ORDER BY t.order_seq LIMIT ?`,
      )
      .all(sessionId, cursor, watermark, watermark, ...filter.parameters, limit + 1);
    const entries = rows.map((row) => ({
      ...decodeTraceVersion(row),
      cursor: checked(orderedRow, row).order_seq,
    }));
    const selected = entries.slice(0, limit);
    const items = selected.map(({ entry }) => entry);
    return checked(TracePageSchema, {
      items,
      watermark,
      nextCursor: entries.length > limit ? (selected.at(-1)?.cursor ?? null) : null,
    });
  }

  public request(
    sessionId: string,
    requestId: string,
    input: ModelRequestDetailQuery = {},
  ): ModelRequestDetail {
    const query = checked(ModelRequestDetailQuerySchema, input);
    traceSession(this.db, sessionId);
    const summary = this.projection.latest(sessionId, requestId)?.request;
    if (summary === undefined || summary === null)
      throw new StorageError('TRACE_NOT_FOUND', 'Model request does not belong to this session');
    const section = query.section ?? 'messages';
    if (summary.preparedSeq === null)
      return checked(ModelRequestDetailSchema, {
        summary,
        section,
        items: [],
        nextCursor: null,
        nextOffset: null,
      });
    const source = this.journal.requestSnapshot(sessionId, summary.preparedSeq);
    const page = contentPage(
      source.count(section),
      (index) => {
        if (section === 'tools')
          return {
            role: 'tool',
            text: JSON.stringify(source.read(section, index), null, 2),
            images: 0,
          };
        const content = requestContent(source.read(section, index));
        if (section === 'system') content.role = 'system';
        return content;
      },
      query,
    );
    return checked(ModelRequestDetailSchema, { summary, section, ...page });
  }

  public entry(
    sessionId: string,
    entryId: string,
    input: ModelRequestDetailQuery = {},
  ): TraceEntryDetail {
    const query = checked(ModelRequestDetailQuerySchema, input);
    traceSession(this.db, sessionId);
    const version = this.projection.latest(sessionId, entryId);
    if (version === undefined)
      throw new StorageError('TRACE_NOT_FOUND', 'Trace entry does not belong to this session');
    if (version.request !== null) {
      const detail = this.request(sessionId, version.request.modelRequestId, query);
      return checked(TraceEntryDetailSchema, {
        entry: version.entry,
        items: detail.items,
        nextCursor: detail.nextCursor,
        nextOffset: detail.nextOffset,
      });
    }
    const row: unknown = this.db
      .prepare('SELECT data FROM tool_calls WHERE session_id=? AND id=?')
      .get(sessionId, version.entry.toolCallId);
    if (row === undefined) throw new StorageError('TRACE_NOT_FOUND', 'Trace tool is unavailable');
    const tool = checked(ToolCallRecordSchema, JSON.parse(checked(dataRow, row).data));
    const canonical: unknown = this.db
      .prepare('SELECT private_data FROM tool_contexts WHERE session_id=? AND tool_call_id=?')
      .get(sessionId, tool.id);
    const result =
      canonical === undefined
        ? { role: 'result', text: tool.result ?? tool.summary, images: 0 }
        : {
            ...requestContent(
              checked(
                StoredToolResultSchema,
                JSON.parse(checked(privateRow, canonical).private_data),
              ),
            ),
            role: 'result',
          };
    const parts: TraceContentSource[] = [
      { ...requestContent(tool.arguments), role: 'arguments' },
      result,
    ];
    if (tool.approval !== undefined)
      parts.push({ role: 'approval', text: JSON.stringify(tool.approval, null, 2), images: 0 });
    parts.push({ role: 'dispatch', text: JSON.stringify(tool.dispatch, null, 2), images: 0 });
    if (tool.diff !== null) parts.push({ role: 'diff', text: tool.diff, images: 0 });
    return checked(TraceEntryDetailSchema, {
      entry: version.entry,
      ...contentPage(
        parts.length,
        (index) => parts[index] ?? { role: 'text', text: '', images: 0 },
        query,
      ),
    });
  }

  /** Return only a selected safe raster image from an authorized final request snapshot. */
  public image(
    sessionId: string,
    requestId: string,
    itemIndex: number,
    imageIndex: number,
  ): ModelRequestImage {
    traceSession(this.db, sessionId);
    if (
      !Number.isSafeInteger(itemIndex) ||
      itemIndex < 0 ||
      !Number.isSafeInteger(imageIndex) ||
      imageIndex < 0
    )
      throw new StorageError('INVALID_RECORD', 'Request image position is invalid');
    const request = this.projection.latest(sessionId, requestId)?.request;
    if (request?.preparedSeq === null || request?.preparedSeq === undefined)
      throw new StorageError('TRACE_NOT_FOUND', 'Request image is unavailable');
    const snapshot = this.journal.requestSnapshot(sessionId, request.preparedSeq);
    if (itemIndex >= snapshot.count('messages'))
      throw new StorageError('TRACE_NOT_FOUND', 'Request image is unavailable');
    const raw = snapshot.read('messages', itemIndex);
    const envelope = checked(Type.Record(Type.String(), Type.Unknown()), raw);
    const message = checked(Type.Record(Type.String(), Type.Unknown()), envelope['message']);
    const content = message['content'];
    const blocks: readonly unknown[] = Array.isArray(content) ? content : [];
    const images = blocks.filter(
      (part: unknown) =>
        part !== null && typeof part === 'object' && Reflect.get(part, 'type') === 'image',
    );
    const selected = images[imageIndex];
    if (selected === undefined)
      throw new StorageError('TRACE_NOT_FOUND', 'Request image is unavailable');
    const image = checked(
      Type.Object({
        type: Type.Literal('image'),
        data: Type.String({ maxLength: 8_000_000 }),
        mimeType: Type.String(),
      }),
      selected,
    );
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(
        image.mimeType,
      ) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)
    )
      throw new StorageError(
        'INVALID_RECORD',
        'Request image encoding or media type is unsupported',
      );
    const bytes = Buffer.from(image.data, 'base64');
    if (bytes.length === 0 || bytes.length > 6_000_000)
      throw new StorageError('INVALID_RECORD', 'Request image exceeds the supported size');
    return { mimeType: image.mimeType, bytes };
  }
}
