import type {
  AgentMessage,
  AgentMessageInput,
  AgentMessageTarget,
  AgentTask,
  AgentTaskDetail,
  AgentTaskSummary,
} from '@my-pi-harness/protocol';
import type { EventInput } from '../sessions/ports.js';
import { RuntimeError } from '../errors.js';
import { agentMessageId } from './message-key.js';
import type { SubagentStore } from './ports.js';
import type { SubagentNode, SubagentTaskNode } from './types.js';

interface MessagingHost {
  readonly store: Pick<SubagentStore, 'listAgentMessages'>;
  readonly nodes: ReadonlyMap<string, SubagentNode>;
  readonly tasks: ReadonlyMap<string, SubagentTaskNode>;
  requireTask(sessionId: string, taskId: string): AgentTaskSummary;
  detail(sessionId: string, taskId: string): AgentTaskDetail;
  accepting(node: SubagentNode): void;
  inTree(caller: SubagentNode, taskId: string): AgentTaskSummary;
  checkDeadline(node: SubagentNode): void;
  commit(sessionId: string, events: readonly EventInput[]): void;
  resume(parent: SubagentNode, task: AgentTask, text: string, messageId: string): void;
}

/** Own task-message acceptance and delivery; live node indexes remain coordinator-owned. */
export class SubagentMessaging {
  public constructor(private readonly host: MessagingHost) {}

  public message(
    sessionId: string,
    taskId: string,
    input: AgentMessageInput,
  ): Promise<AgentTaskDetail> {
    const task = this.host.requireTask(sessionId, taskId);
    const id = agentMessageId(task.parentRunId, { kind: 'task', taskId }, input.requestId);
    const previous = this.host.store
      .listAgentMessages(sessionId, { kind: 'task', taskId })
      .find((entry) => entry.id === id);
    if (previous) {
      if (previous.text !== input.text)
        throw new RuntimeError('AGENT_MESSAGE_CONFLICT', '相同请求不能替换通信内容。');
      return Promise.resolve(this.host.detail(sessionId, taskId));
    }
    if (task.latestRunId !== input.expectedRunId)
      throw new RuntimeError('AGENT_CONFLICT', '任务执行已变化，请刷新后重试。');
    const parent = this.host.nodes.get(task.parentRunId);
    if (!parent)
      throw new RuntimeError('AGENT_PARENT_ENDED', '直接父任务已经结束，不能续作旧任务。');
    this.send(parent, { kind: 'task', taskId }, input.text, input.requestId, input.continue);
    return Promise.resolve(this.host.detail(sessionId, taskId));
  }

  public send(
    sender: SubagentNode,
    target: AgentMessageTarget,
    text: string,
    requestId: string,
    continueRun: boolean,
  ): AgentMessage {
    this.host.accepting(sender);
    if (!text.trim()) throw new RuntimeError('AGENT_MESSAGE_EMPTY', '通信内容不能为空。');
    const id = agentMessageId(sender.run.id, target, requestId);
    const previous = this.host.store
      .listAgentMessages(sender.session.id)
      .find((message) => message.id === id);
    if (previous) {
      if (previous.text !== text)
        throw new RuntimeError('AGENT_MESSAGE_CONFLICT', '相同请求不能替换通信内容。');
      return previous;
    }
    let node: SubagentNode | undefined;
    if (target.kind === 'run') node = this.host.nodes.get(target.runId);
    else {
      const task = this.host.inTree(sender, target.taskId);
      const parent = this.host.nodes.get(task.parentRunId);
      if (!parent) throw new RuntimeError('AGENT_PARENT_ENDED', '直接父执行已经结束。');
      this.host.accepting(parent);
      node = this.host.tasks.get(target.taskId);
      if (
        task.closedAt !== null ||
        (task.status !== 'completed' && !['queued', 'running', 'waiting'].includes(task.status))
      )
        throw new RuntimeError('AGENT_CLOSED', '目标任务已关闭，不能继续。');
    }
    const idle = node?.execution !== undefined && node.execution.outcome !== 'running';
    if (!node || node.tree !== sender.tree || (node.closing && !(target.kind === 'task' && idle)))
      throw new RuntimeError('AGENT_CLOSED', '目标执行已经结束或不属于当前任务树。');
    this.host.checkDeadline(node);
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
    this.host.commit(sender.session.id, [
      {
        type: 'task.message_queued',
        runId: sender.run.id,
        at: record.createdAt,
        data: { message: record },
      },
    ]);
    if (idle && continueRun && node.task && node.parent) {
      this.host.resume(node.parent, node.task, text, id);
    } else if (!idle) node.execution?.rebuildQueue();
    return (
      this.host.store.listAgentMessages(sender.session.id).find((message) => message.id === id) ?? {
        ...record,
        status: 'queued',
        consumedRunId: null,
        finishedAt: null,
        reason: null,
      }
    );
  }

  public incoming(node: SubagentNode): AgentMessage[] {
    if (node.closing) return [];
    return this.pending(node);
  }

  public undelivered(node: SubagentNode): void {
    const pending = this.pending(node);
    if (pending.length > 0)
      this.host.commit(
        node.session.id,
        pending.map((message) => ({
          type: 'task.message_undelivered',
          runId: node.execution ? node.run.id : (node.parent?.run.id ?? null),
          at: Date.now(),
          data: { messageId: message.id, reason: '目标执行已结束，消息未被消费。' },
        })),
      );
  }

  private pending(node: SubagentNode): AgentMessage[] {
    const target: AgentMessageTarget = node.task
      ? { kind: 'task', taskId: node.task.id }
      : { kind: 'run', runId: node.run.id };
    return this.host.store
      .listAgentMessages(node.session.id, target)
      .filter((message) => message.status === 'queued');
  }
}
