import { randomUUID } from 'node:crypto';
import type { Message } from '@earendil-works/pi-ai';
import {
  initialWorkState,
  type Checkpoint,
  type CheckpointCreate,
  type Compaction,
  type ContextReset,
  type InputRequest,
  type PlanReview,
  type PlanStep,
  type QuestionItem,
  type QuestionResponse,
  type Todo,
  type RuleSource,
  type SessionSnapshot,
  type SessionSummary,
  type WorkPatch,
  type WorkSnapshot,
  type WorkState,
} from '@my-pi-harness/protocol';
import { RuntimeError } from './errors.js';
import type { WorkRuntimeOptions } from './work-ports.js';
import type { ResolvedModel } from './model-gateway.js';
import type { EventInput } from './runtime-ports.js';
import { decodeContextMessage } from './context-codec.js';
import { WorkContext } from './work-context.js';
import { WorkInteractions } from './work-interactions.js';
import { completeToolHistory } from './tool-history.js';
import { buildSystemContext, loadWorkspaceRules } from './context/index.js';
import { userWithAttachments } from './attachment-context.js';

export interface PreparedWork {
  state: WorkState;
  history: Message[];
  systemPrompt: string;
  user: ReturnType<typeof userWithAttachments>;
}
/** Owns context and work commands; the session remains the execution and event publication owner. */
export class WorkRuntime {
  private readonly lifetime = new AbortController();
  public readonly context = new WorkContext(this);
  private readonly interactions = new WorkInteractions(this);
  private readonly compactions = new Map<string, Set<AbortController>>();
  public constructor(public readonly options: WorkRuntimeOptions) {}

  public snapshot(sessionId: string, expectedBranchId?: string): WorkSnapshot {
    const state = this.options.store.getWorkState(sessionId);
    if (expectedBranchId !== undefined) this.checkBranch(state, expectedBranchId);
    return {
      state,
      checkpoints: this.options.store.listCheckpoints(sessionId),
      compactions: this.options.store.listCompactions(sessionId, state.branchId),
    };
  }

  public save(
    sessionId: string,
    state: WorkState,
    runId: string | null = null,
    privateData?: string,
  ): WorkState {
    const current = this.options.store.getWorkState(sessionId, state.branchId);
    const next = { ...state, revision: current.revision + 1 };
    this.options.commit(sessionId, [
      {
        type: 'work.updated',
        runId,
        at: Date.now(),
        data: { state: next },
        ...(privateData === undefined ? {} : { privateData }),
      },
    ]);
    return next;
  }

  public patch(sessionId: string, input: WorkPatch): Promise<WorkSnapshot> {
    return this.options.command(sessionId, () => {
      const current = this.snapshot(sessionId).state;
      this.checkRevision(current, input);
      if (input.todos) this.validateTodos(sessionId, input.todos);
      if (current.plan?.review === 'pending' && input.mode === 'execute')
        throw new RuntimeError('PLAN_REVIEW_REQUIRED', '请先完成计划审核。');
      const { revision: _revision, expectedBranchId: _expectedBranchId, ...patch } = input;
      this.save(sessionId, { ...current, ...patch });
      return this.snapshot(sessionId);
    });
  }

  public async rules(
    workspaceId: string,
    referencePaths: readonly string[] = [],
    signal?: AbortSignal,
  ): Promise<RuleSource[]> {
    const preparationSignal = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    preparationSignal.throwIfAborted();
    const workspace = await this.options.resolveWorkspace(workspaceId);
    return await loadWorkspaceRules({
      workspaceRoot: workspace.rootPath,
      profileDirectory: this.options.profileDirectory,
      referencePaths,
      signal: preparationSignal,
    });
  }

  public async prepare(
    session: SessionSummary,
    sourceBranchId: string,
    messageIds: readonly string[],
    input: InputRequest,
    resolved: ResolvedModel,
    basePrompt: string,
    signal?: AbortSignal,
  ): Promise<PreparedWork> {
    const preparationSignal = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    preparationSignal.throwIfAborted();
    const existing = this.options.store.getSnapshot(session.id);
    const newBranch = !existing.branches.some((branch) => branch.id === session.activeBranchId);
    const state = newBranch
      ? initialWorkState(session.activeBranchId)
      : this.options.store.getWorkState(session.id, session.activeBranchId);
    const visibleIds = this.visibleIds(state, messageIds);
    const historyAttachmentIds = existing.messages
      .filter((message) => visibleIds.includes(message.id))
      .flatMap((message) => message.attachmentIds ?? []);
    const referencePaths = [
      ...new Set([...(input.attachmentIds ?? []), ...historyAttachmentIds]),
    ].flatMap((id) => {
      const attachment = this.options.store.getAttachment(id);
      if (!attachment) throw new RuntimeError('ATTACHMENT_NOT_FOUND', '附件不存在，请重新添加。');
      return attachment.attachment.sourcePath === null ||
        attachment.attachment.workspaceId !== session.workspaceId
        ? []
        : [attachment.attachment.sourcePath];
    });
    const rules =
      session.workspaceId === null
        ? []
        : await this.rules(session.workspaceId, referencePaths, preparationSignal);
    const user = userWithAttachments(
      this.options.store,
      input,
      Date.now(),
      resolved.model.input.includes('image'),
    );
    const ids = this.visibleIds(state, messageIds);
    const history = this.history(session.id, sourceBranchId, ids);
    const systemPrompt = buildSystemContext(basePrompt, rules, state);
    return { state: { ...state, rules, usage: null }, history, user, systemPrompt };
  }

  public async compact(
    sessionId: string,
    input: ContextReset,
    signal?: AbortSignal,
  ): Promise<WorkSnapshot> {
    const { controller, release } = this.ownCompaction(sessionId);
    const combined = AbortSignal.any([
      controller.signal,
      this.lifetime.signal,
      ...(signal ? [signal] : []),
    ]);
    try {
      return await this.options.command(sessionId, async (snapshot) => {
        controller.signal.throwIfAborted();
        const state = this.snapshot(sessionId).state;
        this.checkRevision(state, input);
        let resolved: ResolvedModel | undefined;
        try {
          resolved = await this.options.gateway.resolve(
            snapshot.session.providerId,
            snapshot.session.modelId,
            combined,
          );
          controller.signal.throwIfAborted();
          signal?.throwIfAborted();
          const compacted = await this.compactHistory(
            sessionId,
            snapshot,
            state,
            resolved,
            'manual',
            state.branchId,
            snapshot.messages.map(({ id }) => id),
            combined,
          );
          if (!compacted)
            throw new RuntimeError('CONTEXT_TOO_SHORT', '至少需要三轮对话才能压缩并保留近期内容。');
          return this.snapshot(sessionId);
        } finally {
          resolved?.release();
        }
      });
    } finally {
      release();
    }
  }

  public createCheckpoint(sessionId: string, input: CheckpointCreate): Promise<WorkSnapshot> {
    return this.options.command(sessionId, (snapshot) => {
      this.checkBranch(this.snapshot(sessionId).state, input.expectedBranchId);
      if (this.options.store.listCheckpoints(sessionId).length >= 100)
        throw new RuntimeError('CHECKPOINT_LIMIT', '检查点已达到100个上限。');
      const checkpoint: Checkpoint = {
        id: randomUUID(),
        sessionId,
        branchId: snapshot.session.activeBranchId,
        label: input.label,
        createdAt: Date.now(),
        messageIds: snapshot.messages.map(({ id }) => id),
        state: this.snapshot(sessionId).state,
      };
      this.options.commit(sessionId, [
        { type: 'checkpoint.created', runId: null, at: Date.now(), data: { checkpoint } },
      ]);
      return this.snapshot(sessionId);
    });
  }

  public restore(
    sessionId: string,
    checkpointId: string,
    input: ContextReset,
  ): Promise<WorkSnapshot> {
    return this.options.command(sessionId, () => {
      this.checkRevision(this.snapshot(sessionId).state, input);
      const checkpoint = this.options.store
        .listCheckpoints(sessionId)
        .find(({ id }) => id === checkpointId);
      if (!checkpoint) throw new RuntimeError('CHECKPOINT_NOT_FOUND', '检查点不存在。');
      const branchId = randomUUID();
      const state: WorkState = {
        ...checkpoint.state,
        branchId,
        revision: 1,
        usage: null,
        questions: [],
      };
      const events: EventInput[] = [
        {
          type: 'branch.restored',
          runId: null,
          at: Date.now(),
          data: {
            branch: {
              id: branchId,
              sessionId,
              parentId: checkpoint.branchId,
              forkMessageId: checkpoint.messageIds.at(-1) ?? null,
              createdAt: Date.now(),
            },
            messageIds: checkpoint.messageIds,
          },
        },
        { type: 'branch.selected', runId: null, at: Date.now(), data: { branchId } },
        { type: 'work.updated', runId: null, at: Date.now(), data: { state } },
      ];
      this.options.commit(sessionId, events);
      return this.snapshot(sessionId);
    });
  }

  public reset(sessionId: string, input: ContextReset): Promise<WorkSnapshot> {
    return this.options.command(sessionId, (snapshot) => {
      const current = this.snapshot(sessionId).state;
      this.checkRevision(current, input);
      const next = {
        ...initialWorkState(current.branchId),
        mode: current.mode,
        plan: current.plan,
        todos: current.todos,
        revision: current.revision + 1,
        contextStartAfterMessageId: snapshot.messages.at(-1)?.id ?? null,
      };
      this.options.commit(sessionId, [
        ...snapshot.queue.map(
          (input): EventInput => ({
            type: 'queue.deleted',
            runId: null,
            at: Date.now(),
            data: { inputId: input.id },
          }),
        ),
        { type: 'work.updated', runId: null, at: Date.now(), data: { state: next } },
      ]);
      return this.snapshot(sessionId);
    });
  }

  public answer(
    sessionId: string,
    questionId: string,
    answers: QuestionResponse[] | null,
  ): Promise<WorkSnapshot> {
    return this.options.command(
      sessionId,
      () => {
        this.interactions.answer(sessionId, questionId, answers);
        return this.snapshot(sessionId);
      },
      true,
    );
  }

  public ask(
    sessionId: string,
    runId: string,
    toolCallId: string,
    questions: QuestionItem[],
    signal: AbortSignal,
  ): Promise<string> {
    return this.interactions.ask(
      sessionId,
      runId,
      toolCallId,
      questions,
      AbortSignal.any([signal, this.lifetime.signal]),
    );
  }

  public proposePlan(
    sessionId: string,
    runId: string,
    title: string,
    content: string,
    steps: PlanStep[],
    signal: AbortSignal,
  ): Promise<string> {
    return this.interactions.propose(
      sessionId,
      runId,
      title,
      content,
      steps,
      AbortSignal.any([signal, this.lifetime.signal]),
    );
  }

  public reviewPlan(sessionId: string, planId: string, input: PlanReview): Promise<WorkSnapshot> {
    return this.options.command(
      sessionId,
      () => {
        this.checkRevision(this.snapshot(sessionId).state, input);
        this.interactions.review(sessionId, planId, input);
        return this.snapshot(sessionId);
      },
      true,
    );
  }

  public resetTasks(sessionId: string, input: ContextReset): Promise<WorkSnapshot> {
    return this.options.command(sessionId, () => {
      const state = this.snapshot(sessionId).state;
      this.checkRevision(state, input);
      this.resetWorkingState(sessionId);
      return this.snapshot(sessionId);
    });
  }

  public resetWorkingState(sessionId: string, runId: string | null = null): void {
    const state = this.snapshot(sessionId).state;
    if (state.plan?.review === 'pending')
      throw new RuntimeError('PLAN_REVIEW_PENDING', '请先结束计划审核。');
    this.save(sessionId, { ...state, plan: null, todos: [] }, runId);
  }

  public selectCompaction(
    sessionId: string,
    compactionId: string,
    input: ContextReset,
  ): Promise<WorkSnapshot> {
    return this.options.command(sessionId, () => {
      this.checkRevision(this.snapshot(sessionId).state, input);
      this.restoreCompaction(sessionId, compactionId);
      return this.snapshot(sessionId);
    });
  }

  public restoreCompaction(
    sessionId: string,
    compactionId: string,
    runId: string | null = null,
  ): void {
    const state = this.snapshot(sessionId).state;
    const compaction = this.options.store
      .listCompactions(sessionId, state.branchId)
      .find(({ id }) => id === compactionId);
    if (!compaction) throw new RuntimeError('COMPACTION_NOT_FOUND', '上下文检查点不存在。');
    const snapshot = this.options.store.getSnapshot(sessionId);
    this.save(
      sessionId,
      {
        ...state,
        compaction,
        usage: null,
        contextStartAfterMessageId: snapshot.messages.at(-1)?.id ?? null,
      },
      runId,
    );
  }

  public searchHistory(sessionId: string, query: string, limit = 10): string {
    if (
      query.trim().length < 2 ||
      query.length > 200 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20
    )
      throw new RuntimeError('HISTORY_QUERY_INVALID', '检索词需为2至200字符，结果最多20项。');
    const snapshot = this.options.store.getSnapshot(sessionId);
    const needle = query.toLocaleLowerCase();
    const attachmentRefs = new Map<string, number>();
    for (const message of snapshot.messages.slice(-10_000)) {
      if (message.attachmentIds === undefined) continue;
      for (const id of message.attachmentIds) attachmentRefs.set(id, message.createdAt);
    }
    const candidates = [
      ...snapshot.messages.slice(-10_000).map(({ id, role, text, createdAt }) => ({
        id,
        kind: role,
        text,
        at: createdAt,
        attachmentId: null,
      })),
      ...snapshot.tools.slice(-2000).map(({ id, name, result, updatedAt }) => ({
        id,
        kind: `tool:${name}`,
        text: result ?? '',
        at: updatedAt,
        attachmentId: null,
      })),
      ...[...attachmentRefs]
        .slice(-128)
        .map(([id, at]) => ({ id, kind: 'attachment', text: '', at, attachmentId: id })),
    ].sort((a, b) => b.at - a.at);
    const matches = [];
    let scanned = 0;
    let scannedCharacters = 0;
    for (const candidate of candidates) {
      const remaining = 1_000_000 - scannedCharacters;
      if (remaining <= 0) break;
      let source = candidate.text;
      if (candidate.attachmentId !== null) {
        const attachment = this.options.store.getAttachment(candidate.attachmentId);
        source = '';
        if (attachment !== undefined && attachment.text !== null) source = attachment.text;
      }
      const text = source.slice(0, remaining);
      scanned += 1;
      scannedCharacters += text.length;
      const index = text.toLocaleLowerCase().indexOf(needle);
      if (index < 0) continue;
      matches.push({
        id: candidate.id,
        kind: candidate.kind,
        excerpt: text.slice(Math.max(0, index - 300), index + 1700),
      });
      if (matches.length >= limit) break;
    }
    return JSON.stringify({
      matches,
      scanned,
      scannedCharacters,
      scope: 'current session selected branch',
    });
  }

  public validateTodos(sessionId: string, todos: Todo[], runId?: string): void {
    const state = this.snapshot(sessionId).state;
    const snapshot = this.options.store.getSnapshot(sessionId);
    if (new Set(todos.map(({ id }) => id)).size !== todos.length)
      throw new RuntimeError('TODO_INVALID', '任务ID不能重复。');
    if (todos.filter(({ status }) => status === 'in_progress').length > 1)
      throw new RuntimeError('TODO_INVALID', '最多一个任务处于进行中。');
    for (const todo of todos) {
      const previous = state.todos.find(({ id }) => id === todo.id);
      if (todo.planStepId !== null && !state.plan?.steps.some(({ id }) => id === todo.planStepId))
        throw new RuntimeError('TODO_PLAN_STEP_INVALID', '任务关联的计划步骤不存在。');
      if (
        new Set(todo.evidenceToolCallIds).size !== todo.evidenceToolCallIds.length ||
        todo.evidenceToolCallIds.some(
          (id) =>
            !snapshot.tools.some(
              (tool) =>
                tool.id === id &&
                tool.status === 'completed' &&
                (runId === undefined ||
                  tool.runId === runId ||
                  (previous?.status === 'completed' && previous.evidenceToolCallIds.includes(id))),
            ),
        )
      )
        throw new RuntimeError('TODO_EVIDENCE_INVALID', '任务依据必须关联已成功完成的工具。');
      if (
        todo.status === 'completed' &&
        todo.evidenceToolCallIds.length === 0 &&
        !todo.completionNote?.trim()
      )
        throw new RuntimeError(
          'TODO_COMPLETION_REQUIRED',
          '完成任务需要工具依据或明确的完成结论。',
        );
    }
  }

  public close(): void {
    this.lifetime.abort();
  }

  /** Cancellation must precede session serialization because a summary may own that command slot. */
  public cancelCompaction(sessionId: string): void {
    const controllers = this.compactions.get(sessionId);
    if (controllers === undefined) return;
    for (const controller of controllers) controller.abort();
  }

  private ownCompaction(sessionId: string): { controller: AbortController; release: () => void } {
    const controller = new AbortController();
    let controllers = this.compactions.get(sessionId);
    if (controllers === undefined) {
      controllers = new Set<AbortController>();
      this.compactions.set(sessionId, controllers);
    }
    controllers.add(controller);
    return {
      controller,
      release: (): void => {
        controllers.delete(controller);
        if (controllers.size === 0) this.compactions.delete(sessionId);
      },
    };
  }

  private checkBranch(state: WorkState, expectedBranchId: string): void {
    if (state.branchId !== expectedBranchId)
      throw new RuntimeError('WORK_CONFLICT', '当前分支已切换，请刷新后再试。');
  }

  private checkRevision(state: WorkState, input: ContextReset): void {
    this.checkBranch(state, input.expectedBranchId);
    if (state.revision !== input.revision)
      throw new RuntimeError('WORK_CONFLICT', '工作状态已更新，请刷新后再试。');
  }

  public visibleIds(state: WorkState, messageIds: readonly string[]): string[] {
    let start = 0;
    for (const marker of [state.contextStartAfterMessageId, state.compaction?.throughMessageId]) {
      if (marker === null || marker === undefined) continue;
      const index = messageIds.indexOf(marker);
      if (index === -1) throw new RuntimeError('CONTEXT_CORRUPT', '上下文锚点不属于当前历史。');
      start = Math.max(start, index + 1);
    }
    return messageIds.slice(start);
  }

  private history(sessionId: string, branchId: string, ids: readonly string[]): Message[] {
    return completeToolHistory(
      this.options.store.getModelContext(sessionId, branchId, ids).map(decodeContextMessage),
    );
  }

  private async compactHistory(
    sessionId: string,
    snapshot: SessionSnapshot,
    state: WorkState,
    resolved: ResolvedModel,
    reason: Compaction['reason'],
    branchId = state.branchId,
    historyIds: readonly string[] = snapshot.messages.map(({ id }) => id),
    signal?: AbortSignal,
  ): Promise<WorkState | undefined> {
    const visibleIds = this.visibleIds(state, historyIds);
    const messages = snapshot.messages.filter(({ id }) => visibleIds.includes(id));
    const cutoff = messages
      .flatMap((message, index) => (message.role === 'user' ? [index] : []))
      .at(-2);
    if (cutoff === undefined || cutoff === 0) return undefined;
    const prefix = messages.slice(0, cutoff);
    const throughMessageId = prefix.at(-1)?.id;
    if (!throughMessageId) return undefined;
    const source = this.history(
      sessionId,
      branchId,
      prefix.map(({ id }) => id),
    );
    const retained = this.history(
      sessionId,
      branchId,
      messages.slice(cutoff).map(({ id }) => id),
    );
    return await this.context.compact(
      sessionId,
      state,
      resolved,
      source,
      retained,
      throughMessageId,
      reason,
      null,
      (next) => buildSystemContext('', next.rules, next),
      signal ?? this.lifetime.signal,
    );
  }
}
