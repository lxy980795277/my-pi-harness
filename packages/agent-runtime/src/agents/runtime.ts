import { randomUUID } from 'node:crypto';
import type {
  AgentBoard,
  AgentBoardQuery,
  AgentMessage,
  AgentMessageInput,
  AgentMessageTarget,
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
  LiveMessageDelta,
} from '@my-pi-harness/protocol';
import type { ModelGateway } from '../models/gateway.js';
import type { ToolRuntime } from '../tools/runtime.js';
import type { WorkRuntime } from '../work/runtime.js';
import type { ExternalTools } from '../tools/external.js';
import type { SkillsPort } from '../capabilities/ports.js';
import type { ToolCatalogSearch } from '../capabilities/search.js';
import type { RunExecution } from '../runs/execution.js';
import type { EventInput } from '../sessions/ports.js';
import type { AgentRunHooks, AgentStore } from './ports.js';
import type { AgentNode, AgentTaskNode, AgentTree } from './types.js';
import type { SpawnAgentInput } from './definitions.js';
import { RuntimeError } from '../errors.js';
import { AgentBudget } from './budget.js';
import { createAgentHooks } from './run-hooks.js';
import { launchAgentRun } from './launch.js';
import { agentMessageId } from './message-key.js';

export interface AgentRuntimeOptions {
  store: AgentStore;
  gateway: Pick<ModelGateway, 'resolve'>;
  tools: ToolRuntime;
  work?: WorkRuntime;
  externalTools?: ExternalTools;
  skills?: SkillsPort;
  search?: ToolCatalogSearch;
  commit(sessionId: string, events: readonly EventInput[]): void;
  publishMessageDelta(sessionId: string, delta: LiveMessageDelta): void;
  onError(error: unknown): void;
}

/** Owns one daemon's structured task trees; the journal owns every recoverable fact. */
export class AgentRuntime {
  private readonly nodes = new Map<string, AgentNode>();
  private readonly tasks = new Map<string, AgentTaskNode>();
  private readonly listeners = new Set<() => void>();
  private closed = false;

  public constructor(public readonly options: AgentRuntimeOptions) {}

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

  public rootHooks(session: SessionSummary, run: RunView, settings: AgentSettings): AgentRunHooks {
    this.ensureOpen();
    const tree: AgentTree = {
      rootRunId: run.id,
      settings: structuredClone(settings),
      budget: new AgentBudget(settings.limits),
      nodes: new Set(),
      writer: run.id,
      writes: new Map(),
      timer: undefined,
    };
    const node = this.node(session, run, tree, undefined, undefined);
    tree.nodes.add(node);
    this.nodes.set(run.id, node);
    return createAgentHooks(this, node);
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
    parent: AgentNode,
    sourceToolCallId: string,
    input: SpawnAgentInput,
  ): AgentTaskSummary {
    this.accepting(parent);
    const existing = this.options.store.findTaskBySource(parent.session.id, sourceToolCallId);
    if (existing) return existing;
    const tree = parent.tree;
    const currentSettings = this.settings();
    if (!currentSettings.enabled)
      throw new RuntimeError('AGENTS_DISABLED', '子 Agent 已停用，不能再创建任务。');
    const role = currentSettings.roles.find((entry) => entry.id === input.roleId && entry.enabled);
    if (!role) throw new RuntimeError('AGENT_ROLE_UNAVAILABLE', '选择的子 Agent 角色未启用。');
    if (
      (parent.task?.role.access === 'read-only' || parent.session.approvalMode === 'read-only') &&
      role.access === 'write'
    )
      throw new RuntimeError('AGENT_PERMISSION', '只读任务不能创建写入角色。');
    const count = [...tree.nodes].filter((entry) => entry.task).length;
    if (
      count >= Math.min(tree.settings.limits.maxTasks, currentSettings.limits.maxTasks) ||
      parent.depth >= Math.min(parent.limits.maxDepth, currentSettings.limits.maxDepth)
    )
      throw new RuntimeError('AGENT_LIMIT', '任务数量或嵌套深度已达到上限。');
    const limits = { ...parent.limits };
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      limits[key] = Math.min(limits[key], currentSettings.limits[key]);
      const requested = input.limits?.[key];
      if (requested !== undefined) limits[key] = Math.min(limits[key], requested);
    }
    for (let scope: AgentNode | undefined = parent; scope; scope = scope.parent) {
      const ancestor = scope;
      const descendants = [...tree.nodes].filter(
        (entry) => entry.task && this.isDescendant(entry, ancestor),
      );
      if (descendants.length >= scope.limits.maxTasks)
        throw new RuntimeError('AGENT_LIMIT', '当前任务或祖先的后代数量已达到上限。');
    }
    const owner = parent.task?.id ?? tree.rootRunId;
    if (role.access === 'write' && (tree.writer !== owner || (tree.writes.get(owner) ?? 0) !== 0))
      throw new RuntimeError('AGENT_WRITE_CONFLICT', '请等待现有写操作结算后再转交写入任务。');
    const available = parent.task
      ? this.options.store.getTaskSnapshot(parent.session.id, parent.task.id)
      : this.options.store.getSnapshot(parent.session.id);
    const attachments = new Set(
      available.messages
        .filter((message) => message.runId === parent.run.id)
        .flatMap((message) => message.attachmentIds ?? []),
    );
    if (input.attachmentIds?.some((id) => !attachments.has(id)))
      throw new RuntimeError('AGENT_ATTACHMENT_SCOPE', '只能转交当前执行已接收的附件。');
    const task: AgentTask = {
      id: randomUUID(),
      sourceToolCallId,
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

  public result(
    caller: AgentNode,
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
    const answer = [...snapshot.messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' &&
          message.status === 'complete' &&
          message.runId === run?.id &&
          (message.stopReason === 'stop' || message.stopReason === 'length'),
      );
    return {
      taskId,
      runId: run?.id ?? null,
      status: run?.status ?? task.status,
      waiting: run?.id === task.latestRunId ? task.waiting : null,
      error: run ? run.error : task.error,
      result: answer?.text.slice(0, 16_000) ?? '',
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

  public message(
    sessionId: string,
    taskId: string,
    input: AgentMessageInput,
  ): Promise<AgentTaskDetail> {
    const task = this.requireTask(sessionId, taskId);
    const id = agentMessageId(task.parentRunId, { kind: 'task', taskId }, input.requestId);
    const previous = this.options.store
      .listAgentMessages(sessionId, { kind: 'task', taskId })
      .find((entry) => entry.id === id);
    if (previous) {
      if (previous.text !== input.text)
        throw new RuntimeError('AGENT_MESSAGE_CONFLICT', '相同请求不能替换通信内容。');
      return Promise.resolve(this.detail(sessionId, taskId));
    }
    if (task.latestRunId !== input.expectedRunId)
      throw new RuntimeError('AGENT_CONFLICT', '任务执行已变化，请刷新后重试。');
    const parent = this.nodes.get(task.parentRunId);
    if (!parent)
      throw new RuntimeError('AGENT_PARENT_ENDED', '直接父任务已经结束，不能续作旧任务。');
    this.send(parent, { kind: 'task', taskId }, input.text, input.requestId, input.continue);
    return Promise.resolve(this.detail(sessionId, taskId));
  }

  public send(
    sender: AgentNode,
    target: AgentMessageTarget,
    text: string,
    requestId: string,
    continueRun: boolean,
  ): AgentMessage {
    this.accepting(sender);
    if (!text.trim()) throw new RuntimeError('AGENT_MESSAGE_EMPTY', '通信内容不能为空。');
    const id = agentMessageId(sender.run.id, target, requestId);
    const previous = this.options.store
      .listAgentMessages(sender.session.id)
      .find((message) => message.id === id);
    if (previous) {
      if (previous.text !== text)
        throw new RuntimeError('AGENT_MESSAGE_CONFLICT', '相同请求不能替换通信内容。');
      return previous;
    }
    let node: AgentNode | undefined;
    if (target.kind === 'run') node = this.nodes.get(target.runId);
    else {
      const task = this.inTree(sender, target.taskId);
      const parent = this.nodes.get(task.parentRunId);
      if (!parent) throw new RuntimeError('AGENT_PARENT_ENDED', '直接父执行已经结束。');
      this.accepting(parent);
      node = this.tasks.get(target.taskId);
      if (
        task.closedAt !== null ||
        (task.status !== 'completed' && !['queued', 'running', 'waiting'].includes(task.status))
      )
        throw new RuntimeError('AGENT_CLOSED', '目标任务已关闭，不能继续。');
    }
    const idle = node?.execution !== undefined && node.execution.outcome !== 'running';
    if (!node || node.tree !== sender.tree || (node.closing && !(target.kind === 'task' && idle)))
      throw new RuntimeError('AGENT_CLOSED', '目标执行已经结束或不属于当前任务树。');
    this.checkDeadline(node);
    if (idle && continueRun && node.task?.role.access === 'write') {
      const parent = node.parent;
      const parentOwner = parent?.task?.id ?? node.tree.rootRunId;
      if (
        !parent ||
        node.tree.writer !== parentOwner ||
        (node.tree.writes.get(parentOwner) ?? 0) !== 0
      )
        throw new RuntimeError('AGENT_WRITE_CONFLICT', '父任务尚不能转交写入拥有权。');
    }
    const record = { id, sourceRunId: sender.run.id, target, text, createdAt: Date.now() };
    this.commit(sender.session.id, [
      {
        type: 'task.message_queued',
        runId: sender.run.id,
        at: record.createdAt,
        data: { message: record },
      },
    ]);
    if (idle && continueRun && node.task && node.parent) {
      if (node.task.role.access === 'write') node.tree.writer = node.task.id;
      const next = this.createChild(node.parent, node.task);
      this.start(next, text, undefined, id);
    } else if (!idle) node.execution?.rebuildQueue();
    return (
      this.options.store
        .listAgentMessages(sender.session.id)
        .find((message) => message.id === id) ?? {
        ...record,
        status: 'queued',
        consumedRunId: null,
        finishedAt: null,
        reason: null,
      }
    );
  }

  public incoming(node: AgentNode): AgentMessage[] {
    if (node.closing) return [];
    const target: AgentMessageTarget = node.task
      ? { kind: 'task', taskId: node.task.id }
      : { kind: 'run', runId: node.run.id };
    return this.options.store
      .listAgentMessages(node.session.id, target)
      .filter((message) => message.status === 'queued');
  }

  public async finish(node: AgentNode, cancel: boolean): Promise<void> {
    node.closing = true;
    const failures: unknown[] = [];
    try {
      this.undelivered(node);
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

  public waiting(node: AgentNode, waiting: AgentTaskSummary['waiting']): void {
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

  public checkDeadline(node: AgentNode): void {
    const root = this.nodes.get(node.tree.rootRunId);
    const now = Date.now();
    if (
      !root ||
      now >= root.run.createdAt + node.tree.settings.limits.timeoutMs ||
      (node.task && now >= node.task.createdAt + node.limits.timeoutMs)
    )
      throw new RuntimeError('AGENT_TIMEOUT', '任务已达到执行时限，不能继续派发。');
  }

  public descendants(caller: AgentNode, ids: readonly string[]): AgentTaskNode[] {
    this.accepting(caller);
    return ids.map((id) => {
      this.inTree(caller, id);
      const node = this.tasks.get(id);
      if (!node || !this.isDescendant(node, caller))
        throw new RuntimeError('AGENT_WAIT_SCOPE', '只能等待或停止自己的后代任务。');
      return node;
    });
  }

  public failTree(node: AgentNode, error: unknown): void {
    for (const entry of node.tree.nodes) {
      entry.error = error;
      entry.controller.abort(error);
      entry.execution?.fail(error);
    }
  }
  public failSubtree(node: AgentNode, error: unknown): void {
    for (const entry of node.tree.nodes)
      if (entry === node || this.isDescendant(entry, node)) {
        entry.error = error;
        entry.controller.abort(error);
        entry.execution?.fail(error);
      }
  }
  public cancelSubtree(node: AgentNode, reason: string): void {
    this.cancelNode(node, reason);
  }
  public returnWriter(node: AgentNode): void {
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
    node: AgentNode,
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
  private createChild(parent: AgentNode, task: AgentTask): AgentTaskNode {
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
    const node: AgentTaskNode = {
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
    tree: AgentTree,
    parent: AgentNode | undefined,
    task: AgentTask | undefined,
  ): AgentNode {
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
      requestCount: 0,
      closing: false,
      error: undefined,
    };
  }
  private closeTask(node: AgentNode, reason: 'completed' | 'cancelled' | 'failed'): void {
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
    this.undelivered(node);
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
  private undelivered(node: AgentNode): void {
    const target: AgentMessageTarget = node.task
      ? { kind: 'task', taskId: node.task.id }
      : { kind: 'run', runId: node.run.id };
    const pending = this.options.store
      .listAgentMessages(node.session.id, target)
      .filter((message) => message.status === 'queued');
    if (pending.length > 0)
      this.commit(
        node.session.id,
        pending.map((message) => ({
          type: 'task.message_undelivered',
          runId: node.execution ? node.run.id : (node.parent?.run.id ?? null),
          at: Date.now(),
          data: { messageId: message.id, reason: '目标执行已结束，消息未被消费。' },
        })),
      );
  }
  private cancelNode(node: AgentNode, reason: string): void {
    const targets = [...node.tree.nodes].filter(
      (entry) => entry === node || this.isDescendant(entry, node),
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
  private isDescendant(candidate: AgentNode, parent: AgentNode): boolean {
    for (let current = candidate.parent; current; current = current.parent)
      if (current === parent) return true;
    return false;
  }
  private inTree(caller: AgentNode, taskId: string): AgentTaskSummary {
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
  private accepting(node: AgentNode): void {
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
