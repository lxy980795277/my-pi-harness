import type { InputRequest } from '@my-pi-harness/protocol';
import type { SubagentCoordinator } from './coordinator';
import type { SubagentNode } from './types';
import type { ResolvedModel } from '../models/gateway';
import { RuntimeError } from '../errors';
import { RunExecution } from '../runs/execution';
import { prepareRun, resolveRunModel } from '../runs/prepare';
import { decodeContextMessage } from '../context/codec';
import { completeToolHistory } from '../context/tool-history';
import { RunCapabilities } from '../capabilities/run';
import { allowedTaskCandidates, allowedTaskTool } from './policy';
import { selectRunTools } from '../tools/selection';
import { capabilityContext } from '../capabilities/context';
import { agentContext } from './definitions';
import { createSubagentRunAdapter } from './run-adapter';
import { canSearchMemories } from '../runs/memory';

/** A child uses the same RunExecution and durable acceptance as a root conversation. */
export async function launchAgentRun(
  owner: SubagentCoordinator,
  node: SubagentNode,
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
    const candidates = allowedTaskCandidates(
      source.acceptedCapabilities?.candidates ?? [],
      task.role.access,
    );
    const skills = source.capabilities?.skills() ?? source.acceptedCapabilities?.skills ?? [];
    const skillCandidates = source.acceptedCapabilities?.skillCandidates ?? [];
    const work = owner.options.work?.forTask(session.id, task.id);
    const settings = owner.settings();
    const canSpawn =
      settings.enabled && node.depth < Math.min(node.limits.maxDepth, settings.limits.maxDepth);
    const selection = selectRunTools({
      registrations: owner.options.tools.registrations,
      workspaceId: session.workspaceId,
      work: owner.options.tools.supportsWorkTools,
      skills: owner.options.skills !== undefined,
      skillDirectory: skillCandidates.length > 0 || skills.length > 0,
      agents: true,
      canSpawn,
      memory: canSearchMemories(source.memory, {
        sessionId: session.id,
        workspaceId: session.workspaceId,
        taskId: task.id,
        userMemoryIds: task.userMemoryIds ?? [],
        query: text,
        signal,
      }),
      allows: (tool) => allowedTaskTool(tool, task.role.access, owner.options.tools.registrations),
      required: ['send_agent_message'],
      inherited: current,
      activeSkills: skills,
      ...(work ? { state: work.snapshot(session.id).state } : {}),
    });
    const toolset = selection.initial;
    const nativeCandidates = selection.nativeCandidates;
    const external = toolset.records.flatMap((record) =>
      record.external ? [record.external] : [],
    );
    if (source.capabilities)
      capabilities = new RunCapabilities({
        runId: node.run.id,
        workspaceId: session.workspaceId,
        initial: toolset,
        candidates,
        nativeCandidates,
        skillCandidates,
        skills,
        ...(owner.options.toolSearch ? { search: owner.options.toolSearch } : {}),
        ...(owner.options.skills ? { skillPort: owner.options.skills } : {}),
        commit: (events) => owner.commit(session.id, events),
      });
    const snapshot = owner.options.store.getTaskSnapshot(session.id, task.id);
    const basePrompt = [
      source.instructionsPrompt ?? source.basePrompt,
      capabilityContext({
        discovery: candidates.length > 0,
        candidates,
        diagnostics: [],
        skills: skillCandidates,
        nativeTools: nativeCandidates
          .filter((tool) => !toolset.definitions.some(({ name }) => name === tool.definition.name))
          .map(({ definition }) => definition),
      }),
      ...(canSpawn ? [agentContext(settings.roles)] : []),
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
          nativeCandidates,
          skillCandidates,
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
      instructionsPrompt: source.instructionsPrompt ?? source.basePrompt,
      eligibleInputIds: [],
      userMemoryIds: task.userMemoryIds ?? [],
      ...(source.memory ? { memory: source.memory } : {}),
      toolset,
      acceptedCapabilities: { external, candidates, skills, skillCandidates },
      ...(capabilities ? { capabilities } : {}),
      tools: owner.options.tools,
      ...(work ? { work } : {}),
      ...(owner.options.externalTools ? { externalTools: owner.options.externalTools } : {}),
      hooks: createSubagentRunAdapter(owner, node),
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
      await execution?.disposeUnstarted();
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
    await capabilities?.close();
    resolved?.release();
    owner.returnWriter(node);
  }
}
