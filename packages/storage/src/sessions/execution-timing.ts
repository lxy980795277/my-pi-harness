import type Database from 'better-sqlite3';
import { Type, type Static } from 'typebox';
import {
  ToolCallRecordSchema,
  WorkStateSchema,
  ModelRequestSummarySchema,
  type HarnessEvent,
  type ToolCallRecord,
} from '@my-pi-harness/protocol';
import { checked } from '../shared/validation';

export type ToolTiming = Static<typeof ToolTimingSchema>;
interface Source {
  sourceRequestId: string | null;
  answerInputMessageId: string | null;
  inputMessageId: string | null;
}

const nullableId = Type.Union([Type.String(), Type.Null()]);
const nullableTime = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
export const ToolTimingSchema = Type.Object(
  {
    runningAt: nullableTime,
    finishedAt: nullableTime,
    durationMs: nullableTime,
    status: Type.String(),
    externalInvocation: Type.Boolean(),
    clockValid: Type.Boolean(),
    lastAt: Type.Integer({ minimum: 0 }),
    sourceRequestId: nullableId,
    answerInputMessageId: nullableId,
    inputMessageId: nullableId,
  },
  { additionalProperties: false },
);
const timingRow = Type.Object({ data: Type.String() });
const sourceRow = Type.Object({ request: Type.String() });
const anchorRow = Type.Object({
  seq: Type.Integer({ minimum: 0 }),
  anchor_message_id: Type.String(),
});
const taskRow = Type.Object({ task_id: nullableId });
const waitRow = Type.Object({ started_at: Type.Integer({ minimum: 0 }), data: Type.String() });
export const WaitTimingStateSchema = Type.Object({
  status: Type.String(),
  closed: Type.Boolean(),
  clockValid: Type.Boolean(),
  lastAt: Type.Integer({ minimum: 0 }),
});

/** Timings derive from existing tool and interaction transitions, without new progress events. */
export class ExecutionTimingProjection {
  public constructor(private readonly db: Database.Database) {}

  public clear(): void {
    this.db.exec('DELETE FROM trace_tool_timings; DELETE FROM trace_human_waits;');
  }

  private task(sessionId: string, runId: string | null): string | null {
    if (runId === null) return null;
    const row: unknown = this.db
      .prepare('SELECT task_id FROM runs WHERE session_id=? AND id=?')
      .get(sessionId, runId);
    return row === undefined ? null : checked(taskRow, row).task_id;
  }

  private requestSource(sessionId: string, runId: string | null, beforeSeq: number): Source {
    const row: unknown = this.db
      .prepare(
        `SELECT request FROM trace_entries WHERE session_id=? AND run_id=? AND purpose='conversation' AND request IS NOT NULL
      AND order_seq<? ORDER BY order_seq DESC, version_seq DESC LIMIT 1`,
      )
      .get(sessionId, runId, beforeSeq * 4);
    if (row === undefined)
      return { sourceRequestId: null, answerInputMessageId: null, inputMessageId: null };
    const request = checked(ModelRequestSummarySchema, JSON.parse(checked(sourceRow, row).request));
    return {
      sourceRequestId: request.modelRequestId,
      answerInputMessageId: request.answerInputMessageId,
      inputMessageId: request.inputMessageId,
    };
  }

  private source(event: HarnessEvent, tool: ToolCallRecord): Source {
    const anchor: unknown = this.db
      .prepare(
        `SELECT e.seq, c.anchor_message_id FROM tool_calls c JOIN events e
      ON e.session_id=c.session_id AND e.type='message.started' AND json_extract(e.data,'$.id')=c.anchor_message_id
      WHERE c.session_id=? AND c.id=?`,
      )
      .get(event.sessionId, tool.id);
    return anchor === undefined
      ? { sourceRequestId: null, answerInputMessageId: null, inputMessageId: null }
      : this.requestSource(event.sessionId, event.runId, checked(anchorRow, anchor).seq);
  }

  private wait(
    event: HarnessEvent,
    id: string,
    runId: string | null,
    branchId: string,
    source: Source,
    status: string,
    startedAt: number,
    pending: boolean,
    interrupted: boolean,
  ): void {
    const row: unknown = this.db
      .prepare('SELECT started_at, data FROM trace_human_waits WHERE session_id=? AND id=?')
      .get(event.sessionId, id);
    if (row === undefined && !pending) return;
    const previous = row === undefined ? null : checked(waitRow, row);
    const state =
      previous === null ? null : checked(WaitTimingStateSchema, JSON.parse(previous.data));
    if (state?.closed) return;
    const start = previous?.started_at ?? startedAt;
    const clockValid =
      state?.clockValid !== false &&
      event.at >= start &&
      (state === null || event.at >= state.lastAt);
    const duration = pending || interrupted || !clockValid ? null : event.at - start;
    this.db
      .prepare(
        `INSERT INTO trace_human_waits(id, session_id, run_id, task_id, branch_id, answer_input_message_id, input_message_id, started_at, duration_ms, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET duration_ms=excluded.duration_ms, data=excluded.data`,
      )
      .run(
        id,
        event.sessionId,
        runId,
        this.task(event.sessionId, runId),
        branchId,
        source.answerInputMessageId,
        source.inputMessageId,
        start,
        duration,
        JSON.stringify({ status, closed: !pending, clockValid, lastAt: event.at }),
      );
  }

  public readTool(sessionId: string, toolId: string): ToolTiming | null {
    const row: unknown = this.db
      .prepare('SELECT data FROM trace_tool_timings WHERE session_id=? AND tool_call_id=?')
      .get(sessionId, toolId);
    return row === undefined
      ? null
      : checked(ToolTimingSchema, JSON.parse(checked(timingRow, row).data));
  }

  private tool(event: HarnessEvent): void {
    const tool = checked(ToolCallRecordSchema, event.data['tool']);
    const previous = this.readTool(event.sessionId, tool.id);
    const source = previous ?? this.source(event, tool);
    const terminal = !['running', 'reviewing', 'awaiting_approval'].includes(tool.status);
    const unknown = tool.status === 'interrupted' || tool.status === 'unknown';
    const runningAt = previous?.runningAt ?? (tool.status === 'running' ? tool.updatedAt : null);
    const clockValid =
      previous?.clockValid !== false &&
      tool.updatedAt >= tool.createdAt &&
      (previous === null || tool.updatedAt >= previous.lastAt) &&
      (runningAt === null || tool.updatedAt >= runningAt);
    const timing: ToolTiming = {
      sourceRequestId: source.sourceRequestId,
      answerInputMessageId: source.answerInputMessageId,
      inputMessageId: source.inputMessageId,
      runningAt,
      finishedAt: terminal && !unknown && clockValid ? tool.updatedAt : null,
      durationMs:
        terminal && !unknown && clockValid ? tool.updatedAt - (runningAt ?? tool.updatedAt) : null,
      status: tool.status,
      externalInvocation: false,
      clockValid,
      lastAt: tool.updatedAt,
    };
    let service: string | null = null;
    if (
      tool.name === 'web_search' ||
      (tool.name === 'web_fetch' && tool.arguments['mode'] !== 'raw')
    ) {
      service = 'deepseek-web';
      timing.externalInvocation = runningAt !== null;
    }
    if (tool.binding.kind === 'accepted' && tool.binding.source.kind === 'mcp') {
      service = `mcp:${tool.binding.source.serverId}`;
      timing.externalInvocation =
        tool.dispatch.state === 'may_have_started' && tool.dispatch.confirmedNotWritten !== true;
    }
    this.db
      .prepare(
        `INSERT INTO trace_tool_timings(tool_call_id, session_id, run_id, task_id, branch_id, source_request_id, answer_input_message_id, input_message_id, service, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tool_call_id) DO UPDATE SET data=excluded.data, service=excluded.service`,
      )
      .run(
        tool.id,
        event.sessionId,
        tool.runId,
        this.task(event.sessionId, event.runId),
        tool.branchId,
        timing.sourceRequestId,
        timing.answerInputMessageId,
        timing.inputMessageId,
        service,
        JSON.stringify(timing),
      );
    this.wait(
      { ...event, at: tool.updatedAt },
      `approval:${tool.id}`,
      tool.runId,
      tool.branchId,
      timing,
      tool.status,
      tool.updatedAt,
      tool.status === 'awaiting_approval',
      unknown,
    );
  }

  public apply(event: HarnessEvent): void {
    if (event.type === 'tool.requested' || event.type === 'tool.updated') this.tool(event);
    if (event.type !== 'work.updated') return;
    const state = checked(WorkStateSchema, event.data['state']);
    for (const question of state.questions) {
      const row: unknown = this.db
        .prepare('SELECT data FROM trace_tool_timings WHERE session_id=? AND tool_call_id=?')
        .get(event.sessionId, question.toolCallId);
      const source =
        row === undefined
          ? this.requestSource(event.sessionId, question.runId, event.seq)
          : checked(ToolTimingSchema, JSON.parse(checked(timingRow, row).data));
      this.wait(
        event,
        `question:${question.id}`,
        question.runId,
        question.branchId,
        source,
        question.status,
        question.createdAt,
        question.status === 'pending',
        question.status === 'interrupted',
      );
    }
    const plan = state.plan;
    if (plan !== null && plan.review !== null) {
      this.wait(
        event,
        `plan:${plan.id}`,
        plan.runId,
        state.branchId,
        this.requestSource(event.sessionId, plan.runId, event.seq),
        plan.review,
        plan.updatedAt,
        plan.review === 'pending',
        plan.review === 'interrupted',
      );
    }
  }
}
