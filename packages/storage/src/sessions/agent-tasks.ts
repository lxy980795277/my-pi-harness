import { and, asc, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  AgentMessageSchema,
  AgentTaskSchema,
  AgentTaskSummarySchema,
  BranchViewSchema,
  MessageViewSchema,
  MessageUsageSchema,
  RunViewSchema,
  SessionSnapshotSchema,
  SessionSummarySchema,
  ToolCallViewSchema,
  type AgentBoard,
  type AgentBoardQuery,
  type AgentMessage,
  type AgentMessageTarget,
  type AgentTaskDetail,
  type AgentTaskSummary,
  type MessageUsage,
  type MessageView,
  type ToolCallView,
  type RunView,
  type SessionSnapshot,
  type WorkState,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { checked } from '../shared/validation.js';
import * as schema from '../sqlite/schema.js';
import { WorkRepository } from './projections/work.js';

interface TaskMessagePage {
  messages: MessageView[];
  nextCursor: number | null;
}

/** Read-only task projections; parent and root relationships come from committed tool sources. */
export class AgentTaskQuery {
  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  public row(sessionId: string, taskId: string): typeof schema.agentTasks.$inferSelect {
    const session = this.db
      .select({ archived: schema.sessions.archived })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    if (!session || session.archived)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    const row = this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .get();
    if (!row || row.sessionId !== sessionId)
      throw new StorageError('INVALID_RECORD', 'Agent task does not belong to this session');
    checked(AgentTaskSchema, row.data);
    return row;
  }

  public runs(sessionId: string, taskId: string): RunView[] {
    this.row(sessionId, taskId);
    return this.db
      .select()
      .from(schema.runs)
      .where(and(eq(schema.runs.sessionId, sessionId), eq(schema.runs.taskId, taskId)))
      .orderBy(sql`rowid`)
      .all()
      .map((row) => checked(RunViewSchema, row.data));
  }

  public messages(
    sessionId: string,
    taskId: string,
  ): { ordinal: number; message: ReturnType<typeof checked<typeof MessageViewSchema>> }[] {
    this.row(sessionId, taskId);
    return this.db
      .select({ ordinal: schema.taskMessages.ordinal, data: schema.messages.data })
      .from(schema.taskMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.taskMessages.messageId))
      .where(and(eq(schema.taskMessages.taskId, taskId), eq(schema.messages.sessionId, sessionId)))
      .orderBy(asc(schema.taskMessages.ordinal))
      .all()
      .map((row) => ({ ordinal: row.ordinal, message: checked(MessageViewSchema, row.data) }));
  }

  public work(sessionId: string, taskId: string): WorkState {
    return new WorkRepository(this.db).getTask(sessionId, taskId);
  }

  public get(sessionId: string, taskId: string): AgentTaskSummary | undefined {
    const stored = this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .get();
    if (!stored || stored.sessionId !== sessionId) return undefined;
    const row = this.row(sessionId, taskId);
    const parent = this.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, row.parentRunId))
      .get();
    if (!parent || parent.sessionId !== sessionId)
      throw new StorageError('INVALID_RECORD', 'Agent task parent is missing');
    const latestRow = this.db
      .select({ data: schema.runs.data })
      .from(schema.runs)
      .where(and(eq(schema.runs.sessionId, sessionId), eq(schema.runs.taskId, taskId)))
      .orderBy(desc(sql`rowid`))
      .limit(1)
      .get();
    const latest = latestRow ? checked(RunViewSchema, latestRow.data) : undefined;
    const state = this.work(sessionId, taskId);
    let waiting = row.waiting;
    if (latest?.status === 'running') {
      if (
        state.questions.some((question) => question.status === 'pending') ||
        state.plan?.review === 'pending'
      )
        waiting = 'user';
      else if (
        this.db
          .select({ id: schema.toolCalls.id })
          .from(schema.toolCalls)
          .where(
            and(
              eq(schema.toolCalls.runId, latest.id),
              sql`json_extract(${schema.toolCalls.data}, '$.status') = 'awaiting_approval'`,
            ),
          )
          .get()
      )
        waiting = 'approval';
    } else waiting = null;
    let status: AgentTaskSummary['status'] = 'queued';
    if (row.closeReason !== null)
      status =
        checked(AgentTaskSummarySchema.properties.closeReason, row.closeReason) ?? 'interrupted';
    else if (latest)
      status = latest.status === 'running' && waiting !== null ? 'waiting' : latest.status;
    const usage = this.usage(sessionId, taskId);
    return checked(AgentTaskSummarySchema, {
      ...row.data,
      sessionId,
      branchId: row.branchId,
      parentRunId: row.parentRunId,
      parentTaskId: parent.data.taskId ?? null,
      rootRunId: row.rootRunId,
      latestRunId: latest?.id ?? null,
      status,
      waiting,
      updatedAt: Math.max(row.updatedAt, latest?.finishedAt ?? latest?.createdAt ?? row.createdAt),
      finishedAt: row.closedAt ?? latest?.finishedAt ?? null,
      closedAt: row.closedAt,
      closeReason: row.closeReason,
      error: row.error ?? latest?.error ?? null,
      usage,
    });
  }

  public list(sessionId: string, branchId?: string): AgentTaskSummary[] {
    const session = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    if (!session || session.archived)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist');
    const selected = branchId ?? session.data.activeBranchId;
    const branch = this.db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(and(eq(schema.branches.id, selected), eq(schema.branches.sessionId, sessionId)))
      .get();
    if (!branch)
      throw new StorageError('INVALID_RECORD', 'Task branch does not belong to this session');
    const anchors = new Set(
      this.db
        .select({ id: schema.branchMessages.messageId })
        .from(schema.branchMessages)
        .where(eq(schema.branchMessages.branchId, selected))
        .all()
        .map((row) => row.id),
    );
    return this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.sessionId, sessionId))
      .orderBy(asc(schema.agentTasks.createdAt), asc(schema.agentTasks.id))
      .all()
      .filter((row) => anchors.has(row.anchorMessageId))
      .map((row) => {
        const task = this.get(sessionId, row.id);
        if (!task) throw new StorageError('INVALID_RECORD', 'Task disappeared while reading');
        return task;
      });
  }

  public board(query: AgentBoardQuery): AgentBoard {
    const offset = query.cursor ?? 0;
    const limit = query.limit ?? 100;
    const latestStatus = sql`(SELECT json_extract(r.data, '$.status') FROM runs r WHERE r.task_id = ${schema.agentTasks.id} ORDER BY r.rowid DESC LIMIT 1)`;
    const active = sql`${schema.agentTasks.closedAt} IS NULL AND (${latestStatus} IS NULL OR ${latestStatus} = 'running')`;
    const pending = sql`(EXISTS (SELECT 1 FROM task_work_states tw WHERE tw.task_id = ${schema.agentTasks.id} AND (json_extract(tw.data, '$.plan.review') = 'pending' OR EXISTS (SELECT 1 FROM json_each(tw.data, '$.questions') q WHERE json_extract(q.value, '$.status') = 'pending'))) OR EXISTS (SELECT 1 FROM tool_calls tc INNER JOIN runs r ON r.id = tc.run_id WHERE r.task_id = ${schema.agentTasks.id} AND json_extract(r.data, '$.status') = 'running' AND json_extract(tc.data, '$.status') = 'awaiting_approval'))`;
    let filter: SQL | undefined;
    if (query.filter === 'active') filter = active;
    else if (query.filter === 'pending') filter = sql`${active} AND ${pending}`;
    else if (query.filter === 'ended') filter = sql`NOT (${active})`;
    const rows = this.db
      .select({ taskId: schema.agentTasks.id, sessionId: schema.agentTasks.sessionId })
      .from(schema.agentTasks)
      .innerJoin(schema.sessions, eq(schema.sessions.id, schema.agentTasks.sessionId))
      .where(
        and(
          eq(schema.sessions.archived, false),
          filter,
          ...(query.workspaceId === undefined
            ? []
            : [eq(schema.sessions.workspaceId, query.workspaceId)]),
          sql`EXISTS (SELECT 1 FROM branch_messages bm WHERE bm.message_id = ${schema.agentTasks.anchorMessageId} AND bm.branch_id = json_extract(${schema.sessions.data}, '$.activeBranchId'))`,
        ),
      )
      .orderBy(desc(schema.agentTasks.updatedAt), asc(schema.agentTasks.id))
      .limit(limit + 1)
      .offset(offset)
      .all();
    return {
      tasks: rows.slice(0, limit).map((row) => {
        const task = this.get(row.sessionId, row.taskId);
        if (!task) throw new StorageError('INVALID_RECORD', 'Task disappeared while reading');
        return task;
      }),
      nextCursor: rows.length > limit ? offset + limit : null,
    };
  }

  public queue(sessionId: string, target?: AgentMessageTarget): AgentMessage[] {
    const clause =
      target === undefined
        ? undefined
        : target.kind === 'run'
          ? eq(schema.agentMessages.targetRunId, target.runId)
          : eq(schema.agentMessages.targetTaskId, target.taskId);
    return this.db
      .select()
      .from(schema.agentMessages)
      .where(and(eq(schema.agentMessages.sessionId, sessionId), clause))
      .orderBy(sql`rowid`)
      .all()
      .map((row) => checked(AgentMessageSchema, row.data));
  }

  public snapshot(sessionId: string, taskId: string): SessionSnapshot {
    const task = this.row(sessionId, taskId);
    const session = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    const branch = this.db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.id, task.branchId))
      .get();
    if (!session || !branch)
      throw new StorageError('INVALID_RECORD', 'Task session or branch is missing');
    return checked(SessionSnapshotSchema, {
      session: checked(SessionSummarySchema, session.data),
      snapshotSeq: session.snapshotSeq,
      liveRevision: 0,
      branches: [checked(BranchViewSchema, branch.data)],
      messages: this.messages(sessionId, taskId).map((row) => row.message),
      runs: this.runs(sessionId, taskId),
      tools: this.tools(sessionId, taskId),
      queue: [],
    });
  }

  public detail(sessionId: string, taskId: string, cursor = 0, limit = 100): AgentTaskDetail {
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200
    )
      throw new StorageError('INVALID_RECORD', 'Invalid task pagination');
    const task = this.get(sessionId, taskId);
    if (!task) throw new StorageError('INVALID_RECORD', 'Task does not belong to this session');
    const page = this.messagePage(sessionId, taskId, cursor, limit);
    const session = this.db
      .select({ snapshotSeq: schema.sessions.snapshotSeq })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    if (!session) throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist');
    return {
      task,
      messages: page.messages,
      runs: this.runs(sessionId, taskId),
      tools: this.tools(
        sessionId,
        taskId,
        page.messages.map((message) => message.id),
      ),
      work: this.work(sessionId, taskId),
      snapshotSeq: session.snapshotSeq,
      liveRevision: 0,
      nextCursor: page.nextCursor,
    };
  }

  /** Read one page plus an ID-only lookahead; off-page message bodies are never loaded. */
  private messagePage(
    sessionId: string,
    taskId: string,
    cursor: number,
    limit: number,
  ): TaskMessagePage {
    const positions = this.db
      .select({ id: schema.taskMessages.messageId, ordinal: schema.taskMessages.ordinal })
      .from(schema.taskMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.taskMessages.messageId))
      .where(
        and(
          eq(schema.taskMessages.taskId, taskId),
          gt(schema.taskMessages.ordinal, cursor),
          eq(schema.messages.sessionId, sessionId),
        ),
      )
      .orderBy(asc(schema.taskMessages.ordinal))
      .limit(limit + 1)
      .all();
    const page = positions.slice(0, limit);
    const messages = new Map(
      (page.length === 0
        ? []
        : this.db
            .select({ data: schema.messages.data })
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.sessionId, sessionId),
                inArray(
                  schema.messages.id,
                  page.map((position) => position.id),
                ),
              ),
            )
            .all()
      ).map((row) => {
        const message = checked(MessageViewSchema, row.data);
        return [message.id, message];
      }),
    );
    return {
      messages: page.map((position) => {
        const message = messages.get(position.id);
        if (!message) throw new StorageError('INVALID_RECORD', 'Task message is missing');
        return message;
      }),
      nextCursor: positions.length > limit ? (page.at(-1)?.ordinal ?? null) : null,
    };
  }

  /** Detail reads only its task's page tools and pending approvals; snapshots retain all task tools. */
  private tools(sessionId: string, taskId: string, anchors?: readonly string[]): ToolCallView[] {
    const page =
      anchors === undefined
        ? undefined
        : or(
            anchors.length === 0
              ? undefined
              : inArray(schema.toolCalls.anchorMessageId, [...anchors]),
            sql`json_extract(${schema.toolCalls.data}, '$.status') IN ('awaiting_approval', 'reviewing')`,
          );
    return this.db
      .select({ data: schema.toolCalls.data, anchor: schema.toolCalls.anchorMessageId })
      .from(schema.toolCalls)
      .innerJoin(schema.runs, eq(schema.runs.id, schema.toolCalls.runId))
      .where(
        and(
          eq(schema.toolCalls.sessionId, sessionId),
          eq(schema.runs.sessionId, sessionId),
          eq(schema.runs.taskId, taskId),
          page,
        ),
      )
      .orderBy(asc(sql`${schema.toolCalls}.rowid`))
      .all()
      .map((row) => checked(ToolCallViewSchema, { ...row.data, afterMessageId: row.anchor }));
  }

  private usage(sessionId: string, taskId: string): MessageUsage | null {
    const members = sql`WITH RECURSIVE subtree(id) AS (
      SELECT id FROM agent_tasks WHERE session_id = ${sessionId} AND id = ${taskId}
      UNION
      SELECT child.id FROM agent_tasks child
      INNER JOIN runs parent ON parent.id = child.parent_run_id
      INNER JOIN subtree ON parent.task_id = subtree.id
      WHERE child.session_id = ${sessionId}
    ) SELECT id FROM subtree`;
    let usage: MessageUsage | null = null;
    for (const row of this.db
      .select({ usage: sql<string>`json_extract(${schema.messages.data}, '$.usage')` })
      .from(schema.taskMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.taskMessages.messageId))
      .where(
        and(
          eq(schema.messages.sessionId, sessionId),
          sql`${schema.taskMessages.taskId} IN (${members})`,
          sql`json_type(${schema.messages.data}, '$.usage') IS NOT NULL`,
        ),
      )
      .all()) {
      const reported = checked(MessageUsageSchema, JSON.parse(row.usage));
      usage ??= {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      };
      for (const field of [
        'inputTokens',
        'outputTokens',
        'cacheReadTokens',
        'cacheWriteTokens',
        'totalTokens',
      ] as const)
        usage[field] += reported[field];
    }
    return usage;
  }
}
