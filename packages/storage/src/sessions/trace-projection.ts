import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import {
  ModelRequestSummarySchema,
  TraceEntrySchema,
  ToolCallRecordSchema,
  MessageViewSchema,
  RunViewSchema,
  type HarnessEvent,
  type TraceEntry,
  type ModelRequestSummary,
} from '@my-pi-harness/protocol';
import {
  ModelRequestStartedSchema,
  ModelRequestCompletedSchema,
  ModelRequestPriceSnapshotSchema,
} from '@my-pi-harness/protocol/internal';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';
import { ExecutionTimingProjection } from './execution-timing';

export interface TraceVersion {
  entry: TraceEntry;
  request: ModelRequestSummary | null;
}

const rowSchema = Type.Object({
  entry: Type.String(),
  request: Type.Union([Type.String(), Type.Null()]),
});
const snapshotTypes = new Set([
  'context.prepared',
  'context.compaction.prepared',
  'tool.review.requested',
]);
const taskRow = Type.Object({ task_id: Type.Union([Type.String(), Type.Null()]) });
const snapshotRow = Type.Object({ seq: Type.Integer({ minimum: 1 }) });
const messageRow = Type.Object({
  data: Type.String(),
  task_id: Type.Union([Type.String(), Type.Null()]),
});
const dataRow = Type.Object({ data: Type.String() });

/** Final inputs stay in JSONL; the SQLite event envelope contains only their references. */
export function isRequestSnapshotEvent(type: string): boolean {
  return snapshotTypes.has(type);
}

/** Validate compact projection rows at the durable SQLite read. */
export function decodeTraceVersion(value: unknown): TraceVersion {
  const row = checked(rowSchema, value);
  return {
    entry: checked(TraceEntrySchema, JSON.parse(row.entry)),
    request:
      row.request === null ? null : checked(ModelRequestSummarySchema, JSON.parse(row.request)),
  };
}

/** Rebuildable versions preserve status filtering at an earlier pagination watermark. */
export class TraceProjection {
  private readonly timing: ExecutionTimingProjection;
  public constructor(private readonly db: Database.Database) {
    this.timing = new ExecutionTimingProjection(db);
  }

  public clear(): void {
    this.timing.clear();
    this.db.exec('DELETE FROM trace_entries; DELETE FROM request_snapshots;');
  }

  public latest(sessionId: string, id: string): TraceVersion | undefined {
    const row: unknown = this.db
      .prepare(
        'SELECT entry, request FROM trace_entries WHERE session_id = ? AND id = ? ORDER BY version_seq DESC LIMIT 1',
      )
      .get(sessionId, id);
    return row === undefined ? undefined : decodeTraceVersion(row);
  }

  private task(sessionId: string, runId: string | null): string | null {
    if (runId === null) return null;
    const row: unknown = this.db
      .prepare('SELECT task_id FROM runs WHERE session_id = ? AND id = ?')
      .get(sessionId, runId);
    if (row === undefined)
      throw new StorageError('RUN_NOT_FOUND', 'Trace request Run does not belong to the session');
    return checked(taskRow, row).task_id;
  }

  private put(event: HarnessEvent, entry: TraceEntry, request: ModelRequestSummary | null): void {
    checked(TraceEntrySchema, entry);
    if (request !== null) checked(ModelRequestSummarySchema, request);
    this.db
      .prepare(
        `INSERT INTO trace_entries(id, version_seq, session_id, order_seq, branch_id, run_id, task_id, kind, purpose, status, entry, request)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        event.seq,
        event.sessionId,
        entry.seq * 4 + (entry.kind === 'tool' ? 1 : entry.modelRequestId === null ? 2 : 0),
        entry.branchId,
        entry.runId,
        entry.taskId,
        entry.kind,
        request?.purpose ?? null,
        entry.status,
        JSON.stringify(entry),
        request === null ? null : JSON.stringify(request),
      );
  }

  private started(event: HarnessEvent, privateData: Record<string, unknown> | undefined): void {
    const value = checked(ModelRequestStartedSchema, event.data);
    if (this.latest(event.sessionId, value.modelRequestId) !== undefined)
      throw new StorageError('INVALID_EVENT', 'Model request identity was already dispatched');
    if (event.runId !== null) {
      const row: unknown = this.db
        .prepare('SELECT data FROM runs WHERE session_id=? AND id=?')
        .get(event.sessionId, event.runId);
      if (row === undefined)
        throw new StorageError('INVALID_EVENT', 'Request Run is not available');
      const run = checked(RunViewSchema, JSON.parse(checked(dataRow, row).data));
      if (run.status !== 'running' || run.branchId !== value.branchId)
        throw new StorageError('INVALID_EVENT', 'Request requires its running branch execution');
    }
    if (value.inputMessageId !== null) {
      const row: unknown = this.db
        .prepare('SELECT data FROM messages WHERE session_id=? AND id=?')
        .get(event.sessionId, value.inputMessageId);
      if (row === undefined)
        throw new StorageError('INVALID_EVENT', 'Request input is not available in this session');
      const message = checked(MessageViewSchema, JSON.parse(checked(dataRow, row).data));
      if (message.role !== 'user' || message.runId !== event.runId)
        throw new StorageError('INVALID_EVENT', 'Request input must be consumed by its Run');
    }
    if (value.answerInputMessageId !== undefined && value.answerInputMessageId !== null) {
      const row: unknown = this.db
        .prepare(
          `SELECT m.data, r.task_id FROM messages m JOIN runs r ON json_extract(m.data,'$.runId')=r.id
        WHERE m.session_id=? AND m.id=? AND r.session_id=?`,
        )
        .get(event.sessionId, value.answerInputMessageId, event.sessionId);
      if (row === undefined)
        throw new StorageError('INVALID_EVENT', 'Answer source must belong to this session');
      const source = checked(messageRow, row);
      const message = checked(MessageViewSchema, JSON.parse(source.data));
      if (
        source.task_id !== null ||
        message.role !== 'user' ||
        message.agentMessageId !== undefined
      )
        throw new StorageError(
          'INVALID_EVENT',
          'Answer source must be a consumed direct root input',
        );
    }
    const snapshot: unknown = this.db
      .prepare('SELECT seq FROM request_snapshots WHERE session_id = ? AND model_request_id = ?')
      .get(event.sessionId, value.modelRequestId);
    const request: ModelRequestSummary = {
      ...value,
      sessionId: event.sessionId,
      seq: event.seq,
      runId: event.runId,
      taskId: this.task(event.sessionId, event.runId),
      answerInputMessageId: value.answerInputMessageId ?? null,
      queueDurationMs: value.queueDurationMs ?? null,
      preparedSeq: snapshot === undefined ? null : checked(snapshotRow, snapshot).seq,
      finishedAt: null,
      durationMs: null,
      firstResponseMs: null,
      status: 'running',
      usage: null,
      error: null,
      responseId: null,
      pricingSource: 'unknown',
      pricingCatalogVersion: null,
      costEstimate: null,
      cacheWrite1h: null,
    };
    if (privateData?.['priceSnapshot'] !== undefined) {
      const price = checked(ModelRequestPriceSnapshotSchema, privateData['priceSnapshot']);
      request.pricingSource = price.source;
      if (price.source === 'pi-catalog') request.pricingCatalogVersion = price.catalogVersion;
    }
    const kind = value.purpose === 'conversation' ? 'request' : value.purpose;
    this.put(
      event,
      {
        id: request.modelRequestId,
        seq: event.seq,
        kind,
        at: request.startedAt,
        runId: event.runId,
        taskId: request.taskId,
        branchId: request.branchId,
        status: 'running',
        title: request.modelId,
        modelRequestId: request.modelRequestId,
        toolCallId: null,
        durationMs: null,
        error: null,
      },
      request,
    );
  }

  private completed(event: HarnessEvent): void {
    const value = checked(ModelRequestCompletedSchema, event.data);
    const previous = this.latest(event.sessionId, value.modelRequestId);
    if (
      previous?.request === null ||
      previous?.request === undefined ||
      previous.entry.runId !== event.runId
    )
      throw new StorageError('INVALID_EVENT', 'Model request terminal has no matching invocation');
    if (previous.request.status !== 'running')
      throw new StorageError('INVALID_EVENT', 'Model request terminal is duplicated');
    if (
      value.costEstimate !== undefined &&
      (value.usage === undefined ||
        previous.request.pricingSource !== 'pi-catalog' ||
        previous.request.pricingCatalogVersion !== value.costEstimate.catalogVersion)
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Request estimate requires matching frozen pricing and observed usage',
      );
    const request: ModelRequestSummary = {
      ...previous.request,
      status: value.status,
      finishedAt: value.finishedAt,
      durationMs: value.durationMs,
      firstResponseMs: value.firstResponseMs,
      usage: value.usage ?? null,
      error: value.error,
      responseId: value.responseId ?? null,
      costEstimate: value.costEstimate ?? null,
      cacheWrite1h: value.cacheWrite1h ?? null,
    };
    this.put(
      event,
      { ...previous.entry, status: value.status, durationMs: value.durationMs, error: value.error },
      request,
    );
  }

  private tool(event: HarnessEvent): void {
    const tool = checked(ToolCallRecordSchema, event.data['tool']);
    const timing = this.timing.readTool(event.sessionId, tool.id);
    const previous = this.latest(event.sessionId, `tool:${tool.id}`);
    const terminal = !['reviewing', 'awaiting_approval', 'running'].includes(tool.status);
    this.put(
      event,
      {
        id: `tool:${tool.id}`,
        seq: previous?.entry.seq ?? event.seq,
        kind: 'tool',
        at: tool.createdAt,
        branchId: tool.branchId,
        runId: event.runId,
        taskId: this.task(event.sessionId, event.runId),
        status: tool.status,
        title: tool.name.slice(0, 500),
        modelRequestId: null,
        toolCallId: tool.id,
        durationMs: timing?.durationMs ?? null,
        error: tool.status === 'failed' ? tool.summary.slice(0, 2000) : null,
      },
      null,
    );
    if (
      tool.approval !== undefined ||
      tool.status === 'reviewing' ||
      tool.status === 'awaiting_approval'
    ) {
      const id = `approval:${tool.id}`;
      const prior = this.latest(event.sessionId, id);
      let status: string = tool.status;
      if (tool.approval?.decision === 'allow') status = 'approved';
      else if (tool.approval?.decision === 'deny') status = 'denied';
      else if (!terminal) status = 'awaiting_approval';
      const finished = status === 'approved' || status === 'denied' || terminal;
      this.put(
        event,
        {
          id,
          seq: prior?.entry.seq ?? event.seq,
          kind: 'approval',
          at: prior?.entry.at ?? tool.updatedAt,
          branchId: tool.branchId,
          runId: event.runId,
          taskId: this.task(event.sessionId, event.runId),
          status,
          title: tool.name,
          modelRequestId: null,
          toolCallId: tool.id,
          durationMs:
            prior?.entry.durationMs ??
            (finished && timing?.clockValid && tool.updatedAt >= (prior?.entry.at ?? tool.createdAt)
              ? tool.updatedAt - (prior?.entry.at ?? tool.createdAt)
              : null),
          error: null,
        },
        null,
      );
    }
  }

  public apply(event: HarnessEvent, privateData?: Record<string, unknown>): void {
    this.timing.apply(event);
    if (isRequestSnapshotEvent(event.type)) {
      const id = event.data['modelRequestId'];
      if (typeof id === 'string')
        this.db
          .prepare(
            'INSERT INTO request_snapshots(model_request_id, session_id, seq) VALUES (?, ?, ?)',
          )
          .run(id, event.sessionId, event.seq);
    }
    switch (event.type) {
      case 'model.request.started':
        this.started(event, privateData);
        break;
      case 'model.request.completed':
        this.completed(event);
        break;
      case 'tool.requested':
      case 'tool.updated':
        this.tool(event);
        break;
      case 'session.imported':
      case 'run.finished': {
        const runFilter = event.type === 'run.finished' ? ' AND run_id = ?' : '';
        const parameters =
          event.type === 'run.finished' ? [event.sessionId, event.runId] : [event.sessionId];
        const rows: unknown[] = this.db
          .prepare(
            `SELECT entry, request FROM trace_entries t WHERE session_id = ? ${runFilter} AND status='running' AND request IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM trace_entries n WHERE n.session_id=t.session_id AND n.id=t.id AND n.version_seq>t.version_seq)`,
          )
          .all(...parameters);
        for (const row of rows) {
          const previous = decodeTraceVersion(row);
          if (previous.request?.status !== 'running') continue;
          this.put(
            event,
            { ...previous.entry, status: 'interrupted', error: '模型请求未记录终态。' },
            {
              ...previous.request,
              status: 'interrupted',
              error: '模型请求未记录终态。',
            },
          );
        }
        break;
      }
    }
  }
}
