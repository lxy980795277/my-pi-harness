import { randomUUID } from 'node:crypto';
import type {
  AgentBoard,
  AgentBoardQuery,
  AgentSettings,
  AgentSettingsInput,
  AgentTask,
  AgentTaskDetail,
  AgentTaskList,
  AgentTaskStop,
  AgentTaskSummary,
  HarnessEvent,
  RunView,
  SessionSummary,
} from '@my-pi-harness/protocol';
import type { LiveMessageDelta } from '@my-pi-harness/protocol/internal';
import type { ModelGateway } from '../models/gateway';
import type { ToolRuntime } from '../tools/runtime';
import type { WorkRuntime } from '../work/runtime';
import type { ExternalTools } from '../tools/external';
import type { SkillsPort } from '../capabilities/ports';
import type { ToolCatalogSearch } from '@my-pi-harness/tools';
import type { RunExecution } from '../runs/execution';
import type { EventInput } from '../sessions/ports';
import type { SubagentStore } from './ports';
import type { SubagentNode, SubagentTaskNode, SubagentTree } from './types';
import type { SpawnAgentInput } from '@my-pi-harness/tools';
import { RuntimeError } from '../errors';
import { AgentRequestScheduler } from './request-scheduler';
import { createSubagentRunAdapter } from './run-adapter';
import { launchAgentRun } from './launch';
import { SubagentMessaging } from './messaging';
import { assertDelegatedAttachments, isDescendant, resolveDelegationPolicy } from './policy';
import type { RunHooks } from '../runs/ports';
import { runMemoryRequest } from '../runs/memory';

export interface SubagentCoordinatorOptions {
  store: SubagentStore;
  gateway: Pick<ModelGateway, 'resolve'>;
  tools: ToolRuntime;
  work?: WorkRuntime;
  externalTools?: ExternalTools;
  skills?: SkillsPort;
  toolSearch?: ToolCatalogSearch;
  commit(sessionId: string, events: readonly EventInput[]): void;
  publishMessageDelta(sessionId: string, delta: LiveMessageDelta): void;
  onError(error: unknown): void;
}

const AGENT_RESULT_MAX_CHARACTERS = 16_000;

/** Owns one daemon's structured task trees; the journal owns every recoverable fact. */
export class SubagentCoordinator {
  private readonly nodes = new Map<string, SubagentNode>();
  private readonly tasks = new Map<string, SubagentTaskNode>();
  private readonly listeners = new Set<() => void>();
  private closed = false;

  public readonly messaging: SubagentMessaging;

  public constructor(public readonly options: SubagentCoordinatorOptions) {
    this.messaging = new SubagentMessaging({
      store: options.store,
      nodes: this.nodes,
      tasks: this.tasks,
      requireTask: (sessionId, taskId) => this.requireTask(sessionId, taskId),
      detail: (sessionId, taskId) => this.detail(sessionId, taskId),
      accepting: (node) => this.accepting(node),
      inTree: (caller, taskId) => this.inTree(caller, taskId),
      checkDeadline: (node) => this.checkDeadline(node),
      commit: (sessionId, events) => this.commit(sessionId, events),
      resume: (parent, task, text, messageId) => {
        if (task.role.access === 'write') parent.tree.writer = task.id;
        const node = this.createChild(parent, task);
        this.start(node, text, undefined, messageId);
      },
    });
  }

  public settings(): AgentSettings {
    return this.options.store.getAgentSettings();
  }
  public updateSettings(input: AgentSettingsInput): AgentSettings {
    this.ensureOpen();
    const settings = this.options.store.putAgentSettings(input);
    this.notify();
    return settings;
  }
  public list(sessionId: string): AgentTaskList {
    const session = this.options.store.getSession(sessionId);
    if (!session) throw new RuntimeError('SESSION_NOT_FOUND', '会话不存在。');
    return {
      tasks: this.options.store.listAgentTasks(sessionId, session.activeBranchId),
      snapshotSeq: session.snapshotSeq,
    };
  }
  public detail(
    sessionId: string,
    taskId: string,
    cursor?: number,
    limit?: number,
  ): AgentTaskDetail {
    this.requireTask(sessionId, taskId);
    return this.options.store.getAgentTaskDetail(sessionId, taskId, cursor, limit);
  }
  public board(query: AgentBoardQuery): AgentBoard {
    return this.options.store.listAgentBoard(query);
  }
  public subscribeChanges(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }
  public observe(events: readonly HarnessEvent[]): void {
    const changed = events.some((event) => {
      if (event.type.startsWith('task.')) return true;
      if (event.runId === null) return false;
      const node = this.nodes.get(event.runId);
      return node !== undefined && node.tree.nodes.size > 1;
    });
    if (changed) this.notify();
  }

  public rootHooks(session: SessionSummary, run: RunView, settings: AgentSettings): RunHooks {
    this.ensureOpen();
    const tree: SubagentTree = {
      rootRunId: run.id,
      settings: structuredClone(settings),
      scheduler: new AgentRequestScheduler(settings.limits.maxConcurrentRequests),
      nodes: new Set(),
      writer: run.id,
      writes: new Map(),
      timer: undefined,
    };
    const node = this.node(session, run, tree, undefined, undefined);
    tree.nodes.add(node);
    this.nodes.set(run.id, node);
    return createSubagentRunAdapter(this, node);
  }
  public attach(execution: RunExecution): void {
    const node = this.nodes.get(execution.options.run.id);
    if (node) node.execution = execution;
  }
  public releaseRoot(runId: string): void {
    const root = this.nodes.get(runId);
    if (!root) return;
    if (root.tree.timer) clearTimeout(root.tree.timer);
    for (const node of root.tree.nodes) {
      this.nodes.delete(node.run.id);
      if (node.task) {
        this.tasks.delete(node.task.id);
        this.options.work?.releaseTask(node.session.id, node.task.id);
      }
    }
  }

  public spawn(
    parent: SubagentNode,
    sourceToolCallId: string,
    input: SpawnAgentInput,
  ): AgentTaskSummary {
    this.accepting(parent);
    const existing = this.options.store.findTaskBySource(parent.session.id, sourceToolCallId);
    if (existing) return existing;
    const tree = parent.tree;
    const { role, limits } = resolveDelegationPolicy(parent, this.settings(), input);
    const available = parent.task
      ? this.options.store.getTaskSnapshot(parent.session.id, parent.task.id)
      : this.options.store.getSnapshot(parent.session.id);
    assertDelegatedAttachments(parent, available, input.attachmentIds);
    let userMemoryIds: readonly string[] = [];
    if (input.userMemoryIds?.length) {
      const execution = parent.execution;
      const memory = execution?.options.memory;
      if (!execution || !memory?.validateDelegation)
        throw new RuntimeError('MEMORY_DELEGATION_UNAVAILABLE', '当前执行不能转交用户记忆。');
      userMemoryIds = memory.validateDelegation(
        runMemoryRequest(execution.options, execution.memoryQuery(), parent.controller.signal),
        input.userMemoryIds,
      );
    }
    const task: AgentTask = {
      id: randomUUID(),
      sourceToolCallId,
      ...(userMemoryIds.length ? { userMemoryIds: [...userMemoryIds] } : {}),
      title: input.title,
      role: structuredClone(role),
      limits,
      createdAt: Date.now(),
    };
    this.commit(parent.session.id, [
      { type: 'task.created', runId: parent.run.id, at: task.createdAt, data: { task } },
    ]);
    if (role.access === 'write') tree.writer = task.id;
    const node = this.createChild(parent, task);
    if (!tree.timer) {
      const root = this.nodes.get(tree.rootRunId);
      const remaining =
        tree.settings.limits.timeoutMs - (Date.now() - (root?.run.createdAt ?? Date.now()));
      tree.timer = setTimeout(
        () => this.failTree(parent, new RuntimeError('AGENT_TIMEOUT', '任务树已达到执行时限。')),
        Math.max(0, remaining),
      );
    }
    this.start(node, input.task, input.attachmentIds);
    return this.requireTask(parent.session.id, task.id);
  }

  /** Read the selected Run only; partial marks unfinished, model-truncated or return-truncated output. */
  public result(
    caller: SubagentNode,
    taskId: string,
    expectedRunId?: string,
  ): Record<string, unknown> {
    const task = this.inTree(caller, taskId);
    const snapshot = this.options.store.getTaskSnapshot(caller.session.id, taskId);
    const selectedRunId = expectedRunId ?? this.tasks.get(taskId)?.run.id ?? task.latestRunId;
    let run = snapshot.runs.find((entry) => entry.id === selectedRunId);
    if (
      expectedRunId === undefined &&
      task.closeReason !== null &&
      task.closeReason !== run?.status
    )
      run = undefined;
    const messages = [...snapshot.messages]
      .reverse()
      .filter(
        (message) =>
          message.role === 'assistant' &&
          message.runId === run?.id &&
          message.text.trim().length > 0,
      );
    const final =
      run?.status === 'completed'
        ? messages.find(
            (message) =>
              message.status === 'complete' &&
              (message.stopReason === 'stop' || message.stopReason === 'length'),
          )
        : undefined;
    const answer = final ?? messages[0];
    return {
      taskId,
      runId: run?.id ?? null,
      status: run?.status ?? task.status,
      waiting: run?.id === task.latestRunId ? task.waiting : null,
      error: run ? run.error : task.error,
      result: answer?.text.slice(0, AGENT_RESULT_MAX_CHARACTERS) ?? '',
      partial:
        answer !== undefined &&
        (answer !== final ||
          answer.stopReason !== 'stop' ||
          answer.text.length > AGENT_RESULT_MAX_CHARACTERS),
      resultMessageId: answer?.id ?? null,
      closed: task.closedAt !== null,
      pendingMessages: this.options.store
        .listAgentMessages(caller.session.id, { kind: 'task', taskId })
        .filter((message) => message.status === 'queued').length,
    };
  }

  public async stop(
    sessionId: string,
    taskId: string,
    input: AgentTaskStop,
  ): Promise<AgentTaskDetail> {
    const task = this.requireTask(sessionId, taskId);
    if (task.latestRunId !== input.expectedRunId)
      throw new RuntimeError('AGENT_CONFLICT', '任务执行已变化，请刷新后重试。');
    const node = this.tasks.get(taskId);
    if (node) {
      this.cancelNode(node, 'user');
      await node.promise;
      this.closeTask(node, 'cancelled');
    } else if (task.closedAt === null)
      throw new RuntimeError('AGENT_NOT_ACTIVE', '任务已失去执行拥有者。');
    return this.detail(sessionId, taskId);
  }

  public async finish(node: SubagentNode, cancel: boolean): Promise<void> {
    node.closing = true;
    const failures: unknown[] = [];
    try {
      this.messaging.undelivered(node);
    } catch (error) {
      failures.push(error);
    }
    const children = [...node.tree.nodes].filter((entry) => entry.parent === node);
    if (cancel || failures.length > 0)
      for (const child of children) {
        try {
          this.cancelNode(child, 'parent');
        } catch (error) {
          failures.push(error);
        }
      }
    const settled = await Promise.allSettled(children.map((child) => child.promise));
    for (const result of settled) if (result.status === 'rejected') failures.push(result.reason);
    for (const child of children) {
      const outcome = child.execution?.outcome;
      try {
        this.closeTask(
          child,
          cancel || outcome === 'cancelled'
            ? 'cancelled'
            : outcome === 'completed'
              ? 'completed'
              : 'failed',
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Task subtree did not settle safely');
  }

  public waiting(node: SubagentNode, waiting: AgentTaskSummary['waiting']): void {
    if (!node.task || node.closing) return;
    const task = this.requireTask(node.session.id, node.task.id);
    if (task.closedAt !== null || task.waiting === waiting) return;
    this.commit(node.session.id, [
      {
        type: 'task.waiting',
        runId: node.run.id,
        at: Date.now(),
        data: { taskId: node.task.id, waiting },
      },
    ]);
  }

  public checkDeadline(node: SubagentNode): void {
    const root = this.nodes.get(node.tree.rootRunId);
    const now = Date.now();
    if (
      !root ||
      now >= root.run.createdAt + node.tree.settings.limits.timeoutMs ||
      (node.task && now >= node.task.createdAt + node.limits.timeoutMs)
    )
      throw new RuntimeError('AGENT_TIMEOUT', '任务已达到执行时限，不能继续派发。');
  }

  public descendants(caller: SubagentNode, ids: readonly string[]): SubagentTaskNode[] {
    this.accepting(caller);
    return ids.map((id) => {
      this.inTree(caller, id);
      const node = this.tasks.get(id);
      if (!node || !isDescendant(node, caller))
        throw new RuntimeError('AGENT_WAIT_SCOPE', '只能等待或停止自己的后代任务。');
      return node;
    });
  }

  public failTree(node: SubagentNode, error: unknown): void {
    for (const entry of node.tree.nodes) {
      entry.error = error;
      entry.controller.abort(error);
      entry.execution?.fail(error);
    }
  }
  public failSubtree(node: SubagentNode, error: unknown): void {
    for (const entry of node.tree.nodes)
      if (entry === node || isDescendant(entry, node)) {
        entry.error = error;
        entry.controller.abort(error);
        entry.execution?.fail(error);
      }
  }
  public cancelSubtree(node: SubagentNode, reason: string): void {
    this.cancelNode(node, reason);
  }
  public returnWriter(node: SubagentNode): void {
    if (!node.task || node.tree.writer !== node.task.id) return;
    let parent = node.parent;
    while (parent && (parent.closing || parent.controller.signal.aborted)) parent = parent.parent;
    node.tree.writer = parent ? (parent.task?.id ?? node.tree.rootRunId) : null;
  }
  public commit(sessionId: string, events: readonly EventInput[]): void {
    try {
      this.options.commit(sessionId, events);
    } catch (error) {
      for (const node of this.nodes.values())
        if (node.session.id === sessionId) {
          node.controller.abort(error);
          node.execution?.fail(error);
        }
      throw error;
    }
  }
  public async close(): Promise<void> {
    this.closed = true;
    const roots = [...this.nodes.values()].filter((node) => node.parent === undefined);
    const failures: unknown[] = [];
    for (const root of roots) {
      try {
        this.cancelNode(root, 'shutdown');
      } catch (error) {
        failures.push(error);
      }
    }
    const settled = await Promise.allSettled(
      roots.flatMap((root) =>
        [...root.tree.nodes].filter((node) => node.task).map((node) => node.promise),
      ),
    );
    this.listeners.clear();
    for (const result of settled) if (result.status === 'rejected') failures.push(result.reason);
    if (failures.length > 0) throw new AggregateError(failures, 'Task runtime shutdown failed');
  }

  private start(
    node: SubagentNode,
    text: string,
    attachmentIds?: readonly string[],
    messageId?: string,
  ): void {
    node.promise = launchAgentRun(this, node, text, attachmentIds, messageId).catch(
      (error: unknown) => {
        node.error = error;
        this.options.onError(error);
        if (!node.execution) this.closeTask(node, 'failed');
      },
    );
  }
  private createChild(parent: SubagentNode, task: AgentTask): SubagentTaskNode {
    const previous = this.tasks.get(task.id);
    if (previous) {
      parent.tree.nodes.delete(previous);
      this.nodes.delete(previous.run.id);
    }
    const run: RunView = {
      id: randomUUID(),
      sessionId: parent.session.id,
      branchId: parent.run.branchId,
      taskId: task.id,
      providerId: task.role.providerId ?? parent.session.providerId,
      modelId: task.role.modelId ?? parent.session.modelId,
      status: 'running',
      createdAt: Date.now(),
      finishedAt: null,
      error: null,
    };
    const node: SubagentTaskNode = {
      ...this.node(parent.session, run, parent.tree, parent, task),
      parent,
      task,
    };
    parent.tree.nodes.add(node);
    this.nodes.set(run.id, node);
    this.tasks.set(task.id, node);
    return node;
  }
  private node(
    session: SessionSummary,
    run: RunView,
    tree: SubagentTree,
    parent: SubagentNode | undefined,
    task: AgentTask | undefined,
  ): SubagentNode {
    return {
      session,
      run,
      tree,
      parent,
      task,
      depth: parent ? parent.depth + 1 : 0,
      limits: task?.limits ?? tree.settings.limits,
      controller: new AbortController(),
      execution: undefined,
      promise: Promise.resolve(),
      requests: new Set(),
      closing: false,
      error: undefined,
    };
  }
  private closeTask(node: SubagentNode, reason: 'completed' | 'cancelled' | 'failed'): void {
    if (!node.task || this.requireTask(node.session.id, node.task.id).closedAt !== null) return;
    const signal = node.controller.signal;
    if (signal.aborted) {
      const cause: unknown = signal.reason;
      if (cause instanceof RuntimeError && cause.code === 'AGENT_CANCELLED') reason = 'cancelled';
      else {
        reason = 'failed';
        node.error = cause;
      }
    }
    this.messaging.undelivered(node);
    this.commit(node.session.id, [
      {
        type: 'task.closed',
        runId: node.execution ? node.run.id : (node.parent?.run.id ?? null),
        at: Date.now(),
        data: {
          taskId: node.task.id,
          reason,
          closedAt: Date.now(),
          ...(reason === 'failed'
            ? {
                error:
                  node.error instanceof RuntimeError
                    ? node.error.message.slice(0, 2000)
                    : '子任务未能完成，请查看执行详情。',
              }
            : {}),
        },
      },
    ]);
    this.returnWriter(node);
  }
  private cancelNode(node: SubagentNode, reason: string): void {
    const targets = [...node.tree.nodes].filter(
      (entry) => entry === node || isDescendant(entry, node),
    );
    const failures: unknown[] = [];
    for (const target of targets) {
      target.controller.abort(new RuntimeError('AGENT_CANCELLED', '子任务已停止。'));
      const cause: unknown = target.controller.signal.reason;
      if (!(cause instanceof RuntimeError) || cause.code !== 'AGENT_CANCELLED') continue;
      try {
        target.execution?.cancel(reason);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Task cancellation failed');
  }
  private inTree(caller: SubagentNode, taskId: string): AgentTaskSummary {
    const task = this.requireTask(caller.session.id, taskId);
    if (task.rootRunId !== caller.tree.rootRunId)
      throw new RuntimeError('AGENT_SCOPE', '目标不属于当前任务树。');
    return task;
  }
  private requireTask(sessionId: string, taskId: string): AgentTaskSummary {
    const task = this.options.store.getAgentTask(sessionId, taskId);
    if (!task) throw new RuntimeError('AGENT_NOT_FOUND', '任务不存在。');
    return task;
  }
  private accepting(node: SubagentNode): void {
    this.ensureOpen();
    const root = this.nodes.get(node.tree.rootRunId);
    if (node.closing || node.controller.signal.aborted || !root || root.closing)
      throw new RuntimeError('AGENT_PARENT_ENDED', '执行已进入收束，不能再接受子任务命令。');
    this.checkDeadline(node);
  }
  private ensureOpen(): void {
    if (this.closed) throw new RuntimeError('AGENTS_CLOSED', '子 Agent 服务正在关闭。');
  }
  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.options.onError(error);
      }
    }
  }
}
