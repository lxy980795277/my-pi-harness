import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import {
  MessageViewSchema,
  ModelRequestSummarySchema,
  RunViewSchema,
  SessionUsageSchema,
  UsageQuerySchema,
  type AgentTaskSummary,
  type MessageUsage,
  type ModelRequestSummary,
  type SessionUsage,
  type UsageQuery,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors';
import { checked } from '../shared/validation';
import { decodeTraceVersion } from './trace-projection';
import {
  executionFilter,
  latestTraceVersion,
  traceSession,
  type ExecutionFilter,
} from './trace-scope';
import { ToolTimingSchema, WaitTimingStateSchema } from './execution-timing';

interface Interval {
  start: number;
  end: number;
}
interface RequestTotals {
  requestCount: number;
  recordedRequests: number;
  timedRequests: number;
  modelDurationMs: number;
  queueDurationMs: number;
  timedQueueRequests: number;
  pricedRequests: number;
  estimatedRequests: number;
  estimatedCostUsd: number | null;
  tokens: MessageUsage;
  byPurpose: SessionUsage['byPurpose'];
  runIds: Set<string>;
  manualIntervals: Interval[];
  maximumFinished: number;
  allFinished: boolean;
  wallValid: boolean;
}
interface Timings {
  wallValid: boolean;
  toolCalls: number;
  timedToolCalls: number;
  toolDurationMs: number;
  humanWaitMs: number;
  unknownHumanWaits: number;
  maximumFinished: number;
  externalServices: SessionUsage['externalServices'];
  externalServicesOmitted: number;
  omittedExternalInvocations: number;
}
interface WallTime {
  wallDurationMs: number | null;
  wallTimeBasis: SessionUsage['wallTimeBasis'];
}

const tokenFields = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
] as const;
const dataRow = Type.Object({ data: Type.String() });
const requestRow = Type.Object({ request: Type.String() });
const waitRow = Type.Object({
  data: Type.String(),
  started_at: Type.Integer({ minimum: 0 }),
  duration_ms: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});
const serviceRow = Type.Object({
  service: Type.String(),
  invocations: Type.Integer({ minimum: 0 }),
});
const serviceCountRow = Type.Object({
  services: Type.Integer({ minimum: 0 }),
  invocations: Type.Integer({ minimum: 0 }),
});

function emptyTokens(): MessageUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}
function sum(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value))
    throw new StorageError(
      'INVALID_RECORD',
      'Aggregated execution counters exceed the supported integer range',
    );
  return value;
}
function addTokens(target: MessageUsage, value: MessageUsage): void {
  for (const field of tokenFields) target[field] = sum(target[field], value[field]);
}
function sumCost(left: number | null, right: number): number {
  const value = (left ?? 0) + right;
  if (!Number.isFinite(value))
    throw new StorageError(
      'INVALID_RECORD',
      'Aggregated estimated cost exceeds the supported numeric range',
    );
  return value;
}
function purposeTotal(purpose: ModelRequestSummary['purpose']): SessionUsage['byPurpose'][number] {
  return {
    purpose,
    requestCount: 0,
    recordedRequests: 0,
    tokens: emptyTokens(),
    modelDurationMs: 0,
    timedRequests: 0,
    unknownDurationRequests: 0,
    estimatedCostUsd: null,
    estimatedRequests: 0,
  };
}
function unionDuration(intervals: Interval[]): number {
  intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let start = -1;
  let end = -1;
  for (const interval of intervals) {
    if (interval.start > end) {
      if (start >= 0) total = sum(total, end - start);
      start = interval.start;
      end = interval.end;
    } else end = Math.max(end, interval.end);
  }
  return start < 0 ? 0 : sum(total, end - start);
}

/** One request-set aggregation supplies UI totals and model-visible task summaries. */
export class ExecutionUsageQuery {
  public constructor(private readonly db: Database.Database) {}

  private requests(sessionId: string, query: UsageQuery, watermark: number): RequestTotals {
    const filter = executionFilter(this.db, sessionId, query);
    if (query.inputMessageId !== undefined) {
      const field = query.includeDescendants === false ? 'inputMessageId' : 'answerInputMessageId';
      filter.sql.push(`json_extract(t.request,'$.${field}')=?`);
      filter.parameters.push(query.inputMessageId);
    }
    const rows: IterableIterator<unknown> = this.db
      .prepare(
        `SELECT entry, request FROM trace_entries t
      WHERE t.session_id=? AND t.request IS NOT NULL AND ${latestTraceVersion}
      ${filter.sql.map((sql) => `AND ${sql}`).join(' ')}`,
      )
      .iterate(sessionId, watermark, ...filter.parameters);
    const totals: RequestTotals = {
      requestCount: 0,
      recordedRequests: 0,
      timedRequests: 0,
      modelDurationMs: 0,
      queueDurationMs: 0,
      timedQueueRequests: 0,
      pricedRequests: 0,
      estimatedRequests: 0,
      estimatedCostUsd: null,
      tokens: emptyTokens(),
      byPurpose: [],
      runIds: new Set(),
      manualIntervals: [],
      maximumFinished: 0,
      allFinished: true,
      wallValid: true,
    };
    const purposes = new Map<ModelRequestSummary['purpose'], SessionUsage['byPurpose'][number]>();
    for (const row of rows) {
      const request = decodeTraceVersion(row).request;
      if (request === null) continue;
      totals.requestCount += 1;
      let part = purposes.get(request.purpose);
      if (part === undefined) {
        part = purposeTotal(request.purpose);
        purposes.set(request.purpose, part);
      }
      part.requestCount += 1;
      if (request.usage !== null) {
        addTokens(totals.tokens, request.usage);
        addTokens(part.tokens, request.usage);
        totals.recordedRequests += 1;
        part.recordedRequests += 1;
      }
      if (request.durationMs !== null) {
        totals.timedRequests += 1;
        part.timedRequests += 1;
        totals.modelDurationMs = sum(totals.modelDurationMs, request.durationMs);
        part.modelDurationMs = sum(part.modelDurationMs, request.durationMs);
      }
      if (request.queueDurationMs !== null) {
        totals.queueDurationMs = sum(totals.queueDurationMs, request.queueDurationMs);
        totals.timedQueueRequests += 1;
      }
      if (
        request.startedAt < request.queuedAt ||
        (request.finishedAt !== null && request.finishedAt < request.startedAt)
      )
        totals.wallValid = false;
      if (request.pricingSource === 'pi-catalog') totals.pricedRequests += 1;
      if (request.costEstimate !== null) {
        totals.estimatedRequests += 1;
        part.estimatedRequests += 1;
        totals.estimatedCostUsd = sumCost(totals.estimatedCostUsd, request.costEstimate.total);
        part.estimatedCostUsd = sumCost(part.estimatedCostUsd, request.costEstimate.total);
      }
      if (request.runId !== null) totals.runIds.add(request.runId);
      if (request.finishedAt === null) totals.allFinished = false;
      else {
        totals.maximumFinished = Math.max(totals.maximumFinished, request.finishedAt);
        if (request.runId === null)
          totals.manualIntervals.push({ start: request.queuedAt, end: request.finishedAt });
      }
    }
    totals.byPurpose = [...purposes.values()].map((part) => ({
      ...part,
      unknownDurationRequests: part.requestCount - part.timedRequests,
    }));
    return totals;
  }

  private timingFilter(sessionId: string, query: UsageQuery): ExecutionFilter {
    const filter = executionFilter(this.db, sessionId, query);
    if (query.inputMessageId !== undefined) {
      filter.sql.push(
        query.includeDescendants === false ? 't.input_message_id=?' : 't.answer_input_message_id=?',
      );
      filter.parameters.push(query.inputMessageId);
    }
    return filter;
  }

  private timings(sessionId: string, query: UsageQuery): Timings {
    const filter = this.timingFilter(sessionId, query);
    const where = `t.session_id=? ${filter.sql.map((sql) => `AND ${sql}`).join(' ')}`;
    const parameters = [sessionId, ...filter.parameters];
    const value: Timings = {
      wallValid: true,
      toolCalls: 0,
      timedToolCalls: 0,
      toolDurationMs: 0,
      humanWaitMs: 0,
      unknownHumanWaits: 0,
      maximumFinished: 0,
      externalServices: [],
      externalServicesOmitted: 0,
      omittedExternalInvocations: 0,
    };
    const tools: IterableIterator<unknown> = this.db
      .prepare(`SELECT data FROM trace_tool_timings t WHERE ${where}`)
      .iterate(...parameters);
    for (const row of tools) {
      const tool = checked(ToolTimingSchema, JSON.parse(checked(dataRow, row).data));
      if (!tool.clockValid) value.wallValid = false;
      value.toolCalls += 1;
      if (tool.durationMs !== null) {
        value.timedToolCalls += 1;
        value.toolDurationMs = sum(value.toolDurationMs, tool.durationMs);
      }
      if (tool.finishedAt !== null)
        value.maximumFinished = Math.max(value.maximumFinished, tool.finishedAt);
    }
    const waits: IterableIterator<unknown> = this.db
      .prepare(`SELECT started_at, duration_ms, data FROM trace_human_waits t WHERE ${where}`)
      .iterate(...parameters);
    for (const row of waits) {
      const wait = checked(waitRow, row);
      if (!checked(WaitTimingStateSchema, JSON.parse(wait.data)).clockValid)
        value.wallValid = false;
      if (wait.duration_ms === null) value.unknownHumanWaits += 1;
      else {
        value.humanWaitMs = sum(value.humanWaitMs, wait.duration_ms);
        value.maximumFinished = Math.max(value.maximumFinished, wait.started_at + wait.duration_ms);
      }
    }
    const serviceWhere = `${where} AND t.service IS NOT NULL AND json_extract(t.data,'$.externalInvocation')=1`;
    const services: unknown[] = this.db
      .prepare(
        `SELECT service, COUNT(*) AS invocations FROM trace_tool_timings t WHERE ${serviceWhere} GROUP BY service ORDER BY invocations DESC, service LIMIT 200`,
      )
      .all(...parameters);
    let listedInvocations = 0;
    for (const row of services) {
      const service = checked(serviceRow, row);
      listedInvocations = sum(listedInvocations, service.invocations);
      value.externalServices.push({
        ...service,
        estimatedCostUsd: null,
        costStatus: 'unavailable',
      });
    }
    const all = checked(
      serviceCountRow,
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT service) AS services, COUNT(*) AS invocations FROM trace_tool_timings t WHERE ${serviceWhere}`,
        )
        .get(...parameters),
    );
    value.externalServicesOmitted = all.services - services.length;
    value.omittedExternalInvocations = all.invocations - listedInvocations;
    return value;
  }

  private answerWall(
    sessionId: string,
    query: UsageQuery,
    requests: RequestTotals,
    timings: Timings,
  ): WallTime {
    const unknown: WallTime = { wallDurationMs: null, wallTimeBasis: 'answer-span' };
    if (
      requests.requestCount === 0 ||
      !requests.allFinished ||
      !requests.wallValid ||
      !timings.wallValid ||
      timings.toolCalls !== timings.timedToolCalls ||
      timings.unknownHumanWaits > 0
    )
      return unknown;
    const row: unknown = this.db
      .prepare('SELECT data FROM messages WHERE session_id=? AND id=?')
      .get(sessionId, query.inputMessageId);
    if (row === undefined) return unknown;
    const input = checked(MessageViewSchema, JSON.parse(checked(dataRow, row).data));
    let end = Math.max(requests.maximumFinished, timings.maximumFinished);
    for (const runId of requests.runIds) {
      const runRow: unknown = this.db
        .prepare('SELECT data FROM runs WHERE session_id=? AND id=?')
        .get(sessionId, runId);
      if (runRow === undefined) return unknown;
      const run = checked(RunViewSchema, JSON.parse(checked(dataRow, runRow).data));
      if (run.status === 'interrupted') return unknown;
      const latest: unknown = this.db
        .prepare(
          `SELECT request FROM trace_entries WHERE session_id=? AND run_id=? AND purpose='conversation' AND request IS NOT NULL ORDER BY order_seq DESC, version_seq DESC LIMIT 1`,
        )
        .get(sessionId, runId);
      if (latest === undefined) return unknown;
      const request = checked(
        ModelRequestSummarySchema,
        JSON.parse(checked(requestRow, latest).request),
      );
      const belongs =
        query.includeDescendants === false
          ? request.inputMessageId === query.inputMessageId
          : request.answerInputMessageId === query.inputMessageId;
      if (belongs) {
        if (run.status === 'running' || run.finishedAt === null) return unknown;
        end = Math.max(end, run.finishedAt);
      }
    }
    if (input.role !== 'user' || input.createdAt > end) return unknown;
    return { wallDurationMs: end - input.createdAt, wallTimeBasis: 'answer-span' };
  }

  private executionWall(
    sessionId: string,
    query: UsageQuery,
    requests: RequestTotals,
    timings: Timings,
  ): WallTime {
    const filter = executionFilter(this.db, sessionId, query);
    if (query.taskId === undefined && query.runId === undefined)
      filter.sql.push('t.task_id IS NULL');
    const rows: IterableIterator<unknown> = this.db
      .prepare(
        `SELECT t.data FROM (SELECT id AS run_id, task_id, branch_id, data FROM runs WHERE session_id=?) t
      ${filter.sql.length > 0 ? `WHERE ${filter.sql.join(' AND ')}` : ''}`,
      )
      .iterate(sessionId, ...filter.parameters);
    const intervals = [...requests.manualIntervals];
    let runCount = 0;
    for (const row of rows) {
      const run = checked(RunViewSchema, JSON.parse(checked(dataRow, row).data));
      if (
        run.status === 'running' ||
        run.status === 'interrupted' ||
        run.finishedAt === null ||
        run.finishedAt < run.createdAt
      )
        return { wallDurationMs: null, wallTimeBasis: 'execution-union' };
      runCount += 1;
      intervals.push({ start: run.createdAt, end: run.finishedAt });
    }
    if (
      !requests.allFinished ||
      !requests.wallValid ||
      !timings.wallValid ||
      intervals.length === 0
    )
      return { wallDurationMs: null, wallTimeBasis: 'unknown' };
    const basis =
      requests.manualIntervals.length === 0
        ? 'execution-union'
        : runCount === 0
          ? 'request-span'
          : 'observed-union';
    return { wallDurationMs: unionDuration(intervals), wallTimeBasis: basis };
  }

  /** Return the same leaf-token aggregation used by session and answer statistics. */
  public taskUsage(
    sessionId: string,
    taskId: string,
  ): Pick<AgentTaskSummary, 'usage' | 'usageCoverage'> {
    const session = traceSession(this.db, sessionId);
    const totals = this.requests(
      sessionId,
      { taskId, includeDescendants: true },
      session.snapshotSeq,
    );
    return {
      usage: totals.recordedRequests === 0 ? null : totals.tokens,
      usageCoverage: {
        requestCount: totals.requestCount,
        recordedRequests: totals.recordedRequests,
        unknownRequests: totals.requestCount - totals.recordedRequests,
      },
    };
  }

  /** Aggregate unique invocations and observed intervals in the caller's exact execution scope. */
  public read(sessionId: string, input: UsageQuery = {}): SessionUsage {
    const query = checked(UsageQuerySchema, input);
    const session = traceSession(this.db, sessionId);
    const requests = this.requests(sessionId, query, session.snapshotSeq);
    const timing = this.timings(sessionId, query);
    const wall =
      query.inputMessageId === undefined
        ? this.executionWall(sessionId, query, requests, timing)
        : this.answerWall(sessionId, query, requests, timing);
    return checked(SessionUsageSchema, {
      requestCount: requests.requestCount,
      recordedRequests: requests.recordedRequests,
      unknownRequests: requests.requestCount - requests.recordedRequests,
      tokens: requests.tokens,
      modelDurationMs: requests.modelDurationMs,
      timedRequests: requests.timedRequests,
      unknownDurationRequests: requests.requestCount - requests.timedRequests,
      queueDurationMs: requests.queueDurationMs,
      timedQueueRequests: requests.timedQueueRequests,
      unknownQueueRequests: requests.requestCount - requests.timedQueueRequests,
      toolCalls: timing.toolCalls,
      timedToolCalls: timing.timedToolCalls,
      unknownToolDurationCalls: timing.toolCalls - timing.timedToolCalls,
      toolDurationMs: timing.toolDurationMs,
      humanWaitMs: timing.humanWaitMs,
      unknownHumanWaits: timing.unknownHumanWaits,
      ...wall,
      estimatedCostUsd: requests.estimatedCostUsd,
      pricedRequests: requests.pricedRequests,
      unknownPriceRequests: requests.requestCount - requests.pricedRequests,
      estimatedRequests: requests.estimatedRequests,
      unknownEstimateRequests: requests.requestCount - requests.estimatedRequests,
      costComplete:
        requests.requestCount > 0 && requests.estimatedRequests === requests.requestCount,
      costScope: 'model-requests',
      externalServices: timing.externalServices,
      externalServicesOmitted: timing.externalServicesOmitted,
      omittedExternalInvocations: timing.omittedExternalInvocations,
      byPurpose: requests.byPurpose,
    });
  }
}
