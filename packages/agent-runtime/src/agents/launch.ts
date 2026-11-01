import { OFFICE_TOOL_DEFINITIONS } from '@my-pi-harness/execution';
import type { InputRequest } from '@my-pi-harness/protocol';
import type { AgentRuntime } from './runtime.js';
import type { AgentNode } from './types.js';
import type { ResolvedModel } from '../models/gateway.js';
import { RuntimeError } from '../errors.js';
import { RunExecution } from '../runs/execution.js';
import { prepareRun, resolveRunModel } from '../runs/prepare.js';
import { decodeContextMessage } from '../context/codec.js';
import { completeToolHistory } from '../context/tool-history.js';
import { RunCapabilities } from '../capabilities/run.js';
import {
  filterTaskToolset,
  allowedTaskCandidates,
  isReadOnlyWorkspaceTool,
} from '../tools/task-toolset.js';
import { createAgentHooks } from './run-hooks.js';
import { AGENT_TOOL_DEFINITIONS } from './definitions.js';
import { RunToolset, type RunToolSelection } from '../tools/toolset.js';

/** A child uses the same RunExecution and durable acceptance as a root conversation. */
export async function launchAgentRun(
  owner: AgentRuntime,
  node: AgentNode,
  text: string,
  attachmentIds?: readonly string[],
  messageId?: string,
): Promise<void> {
  const task = node.task;
  const parent = node.parent;
  if (!task || !parent?.execution)
    throw new RuntimeError('AGENT_PARENT_ENDED', '委派来源执行已经结束。');
  const timer = setTimeout(
    () => owner.failSubtree(node, new RuntimeError('AGENT_TIMEOUT', '子任务已达到执行时限。')),
    Math.max(0, task.createdAt + node.limits.timeoutMs - Date.now()),
  );
  let resolved: ResolvedModel | undefined;
  let capabilities: RunCapabilities | undefined;
  let execution: RunExecution | undefined;
  let accepted = false;
  let started = false;
  try {
    const signal = node.controller.signal;
    signal.throwIfAborted();
    const thinkingLevel = task.role.thinkingLevel ?? parent.session.thinkingLevel;
    const session = {
      ...parent.session,
      providerId: node.run.providerId,
      modelId: node.run.modelId,
      thinkingLevel,
    };
    resolved = await resolveRunModel(
      owner.options.gateway,
      session,
      signal,
      '子任务模型不支持选择的推理强度。',
    );
    node.session = session;
    const source = parent.execution.options;
    const current = source.capabilities?.active ?? source.toolset;
    const filtered = filterTaskToolset(current, task.role.access);
    const records: RunToolSelection[] = [...filtered.records];
    for (const definition of AGENT_TOOL_DEFINITIONS)
      if (!records.some((record) => record.definition.name === definition.name))
        records.push({ definition, source: { kind: 'session' } });
    const toolset = new RunToolset(records);
    const external = toolset.records.flatMap((record) =>
      record.external ? [record.external] : [],
    );
    const candidates = allowedTaskCandidates(
      source.acceptedCapabilities?.candidates ?? [],
      task.role.access,
    );
    const skills = source.capabilities?.skills() ?? source.acceptedCapabilities?.skills ?? [];
    const workspaceCandidates =
      session.workspaceId === null
        ? []
        : OFFICE_TOOL_DEFINITIONS.filter(
            (definition) =>
              task.role.access === 'write' || isReadOnlyWorkspaceTool(definition.name),
          );
    if (source.capabilities)
      capabilities = new RunCapabilities({
        runId: node.run.id,
        workspaceId: session.workspaceId,
        initial: toolset,
        candidates,
        workspaceCandidates,
        skills,
        ...(owner.options.search ? { search: owner.options.search } : {}),
        ...(owner.options.skills ? { skillPort: owner.options.skills } : {}),
        commit: (events) => owner.commit(session.id, events),
      });
    const work = owner.options.work?.forTask(session.id, task.id);
    const snapshot = owner.options.store.getTaskSnapshot(session.id, task.id);
    const basePrompt = [
      source.basePrompt,
      `You are the delegated ${task.role.name} agent. Work only on the supplied task and explicit inputs. Your context is separate from the parent. Role instructions:\n${task.role.instructions}`,
      'Do not change the parent conversation or its branch. Return a bounded conclusion with evidence and remaining uncertainty. Collect your own delegated results before finishing.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const input: InputRequest = {
      text,
      requestId: `agent:${node.run.id}`,
      mode: 'send',
      ...(attachmentIds ? { attachmentIds: [...attachmentIds] } : {}),
    };
    const prepared = await prepareRun({
      session,
      run: node.run,
      resolved,
      input,
      basePrompt,
      skills,
      sourceBranchId: node.run.branchId,
      messageIds: snapshot.messages.map((message) => message.id),
      history: () =>
        completeToolHistory(
          owner.options.store.getTaskModelContext(session.id, task.id).map(decodeContextMessage),
        ),
      signal,
      ...(work ? { work } : {}),
      ...(messageId
        ? {
            communication: () => {
              const incoming = owner.options.store
                .listAgentMessages(session.id, { kind: 'task', taskId: task.id })
                .find((entry) => entry.id === messageId && entry.status === 'queued');
              if (!incoming) throw new RuntimeError('AGENT_MESSAGE_CONFLICT', '续作通信已失效。');
              return incoming;
            },
          }
        : {}),
    });
    owner.commit(
      session.id,
      prepared.acceptance(
        {
          toolset,
          external,
          candidates,
          diagnostics: [],
          workspaceCandidates,
          skills,
        },
        (at) =>
          messageId
            ? [
                {
                  type: 'task.message_consumed',
                  runId: node.run.id,
                  at,
                  data: { messageId, consumedRunId: node.run.id },
                },
              ]
            : [],
      ),
    );
    accepted = true;
    execution = new RunExecution({
      session,
      run: node.run,
      resolved,
      history: prepared.history,
      user: prepared.user,
      systemPrompt: prepared.systemPrompt,
      basePrompt,
      eligibleInputIds: [],
      toolset,
      acceptedCapabilities: { external, candidates, skills },
      ...(capabilities ? { capabilities } : {}),
      tools: owner.options.tools,
      ...(work ? { work } : {}),
      ...(owner.options.externalTools ? { externalTools: owner.options.externalTools } : {}),
      agents: createAgentHooks(owner, node),
      queue: () => [],
      commit: (events) => owner.commit(session.id, events),
      publishMessageDelta: (delta) => owner.options.publishMessageDelta(session.id, delta),
      onError: (error) => owner.options.onError(error),
    });
    owner.attach(execution);
    execution.rebuildQueue();
    started = true;
    await execution.start();
  } catch (error) {
    if (accepted && !started) {
      execution?.disposeUnstarted();
      if (execution) execution.outcome = 'failed';
      owner.commit(node.session.id, [
        {
          type: 'run.finished',
          runId: node.run.id,
          at: Date.now(),
          data: {
            status: 'failed',
            finishedAt: Date.now(),
            error: '子任务在模型请求前初始化失败。',
          },
        },
      ]);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    capabilities?.close();
    resolved?.release();
    owner.returnWriter(node);
  }
}
