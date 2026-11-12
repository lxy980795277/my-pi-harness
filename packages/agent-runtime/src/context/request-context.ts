import { randomUUID } from 'node:crypto';
import type { Message } from '@earendil-works/pi-ai';
import type {
  Compaction,
  MessageView,
  RunView,
  SessionSummary,
  WorkState,
  SessionSnapshot,
} from '@my-pi-harness/protocol';
import type { FrozenSkill, MemoryRequestSnapshot } from '@my-pi-harness/protocol/internal';
import { memoryPrompt } from './memory';
import type { ResolvedModel } from '../models/gateway';
import type { WorkRuntime } from '../work/runtime';
import type { EventInput } from '../sessions/ports';
import { encodeContextMessage, snapshotPrivateData } from './codec';
import { contextSourceIds } from './sources';
import { buildSystemContext } from './system-context';
import { RuntimeError } from '../errors';
import {
  pruneContext,
  requestUsage,
  selectRequestPrefix,
  type RetainedToolText,
} from './projection';
import { renderSummary, summarizeContext } from './summary';
import { assertCompleteToolCycles, type ContextToolDefinition } from './budget';
import type { RunToolDefinition } from '../tools/toolset';
import { activeSkillContext } from '../capabilities/context';
import { communicationMessage } from './agent-message';
import { toolCallRecordId } from '../tools/ledger';
import { workToolRequirements } from '../tools/selection';

interface RequestTools {
  toolDefinitions: readonly RunToolDefinition[];
  capabilityRevision: number;
  skills: readonly FrozenSkill[];
}

/** A provider projection remains uncommitted until the final dispatch checks pass. */
export interface PreparedContext {
  readonly messages: Message[];
  readonly memory?: MemoryRequestSnapshot;
  isCurrent(): boolean;
  commit(): void;
}

interface RequestProjection {
  session: SessionSummary;
  run: RunView;
  resolved: ResolvedModel;
  messages: Message[];
  basePrompt: string;
  currentTask: string;
  toolDefinitions: readonly RunToolDefinition[];
  capabilityRevision?: number;
  skills?: readonly FrozenSkill[];
  canUseTool?(name: string): boolean;
  resolveTools?(requirements: readonly string[]): RequestTools;
  signal: AbortSignal;
  memory?: MemoryRequestSnapshot;
}
interface RequestBaseline {
  heuristic: number;
  marker: string;
}

/** Only a terminal record in the selected task/branch can provide a retained-text reader identity. */
function retainedToolText(
  messages: readonly Message[],
  sourceAnchors: ReadonlyMap<Message, string>,
  tools: SessionSnapshot['tools'],
): Map<Message, RetainedToolText> {
  const references = new Map<Message, RetainedToolText>();
  for (const message of messages) {
    if (message.role !== 'toolResult') continue;
    const anchor = sourceAnchors.get(message);
    if (anchor === undefined) continue;
    const tool = tools.find(
      (entry) =>
        entry.afterMessageId === anchor &&
        entry.name === message.toolName &&
        entry.id === toolCallRecordId(entry.runId, anchor, message.toolCallId),
    );
    if (
      tool?.result !== undefined &&
      tool.result !== null &&
      tool.status !== 'reviewing' &&
      tool.status !== 'awaiting_approval' &&
      tool.status !== 'running'
    )
      references.set(message, { id: tool.id, text: tool.result });
  }
  return references;
}
/** Associate SDK copies before pruning; tool results inherit their assistant message's durable anchor. */
function anchors(
  messages: readonly Message[],
  stored: readonly MessageView[],
  originalInputs: ReadonlyMap<string, Message>,
): Map<Message, string> {
  const ids = contextSourceIds(messages, stored, originalInputs);
  const result = new Map<Message, string>();
  let index = 0;
  let assistantId: string | undefined;
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'toolResult') {
      if (assistantId) result.set(message, assistantId);
      continue;
    }
    const id = ids[index++];
    if (id) result.set(message, id);
    if (message.role === 'assistant') assistantId = id;
  }
  return result;
}

/** Per-request context owner; original SDK history stays intact while its selected projection is logged. */
export class WorkContext {
  private readonly baselines = new Map<string, RequestBaseline>();
  public constructor(private readonly work: WorkRuntime) {}

  public release(runId: string): void {
    this.baselines.delete(runId);
  }

  public async project(input: RequestProjection): Promise<PreparedContext> {
    input.signal.throwIfAborted();
    const snapshot = this.work.sessionSnapshot(input.session.id);
    const sourceAnchors = anchors(
      input.messages,
      snapshot.messages,
      this.communicationInputs(input.session.id, snapshot.messages),
    );
    let state = this.work.snapshot(input.session.id).state;
    const ids = this.work.visibleIds(
      state,
      snapshot.messages.map(({ id }) => id),
    );
    const selected = new Set(ids);
    let raw = input.messages.filter((message) => {
      if (message.role === 'system') return false;
      const anchor = sourceAnchors.get(message);
      return anchor !== undefined && selected.has(anchor);
    });
    assertCompleteToolCycles(raw);
    const retainedTools = this.canUseTool(input, 'read_tool_result')
      ? retainedToolText(raw, sourceAnchors, snapshot.tools)
      : new Map<Message, RetainedToolText>();
    const taskFor = (messages: readonly Message[]): string =>
      messages.some(
        (message) =>
          message.role === 'user' &&
          (typeof message.content === 'string'
            ? message.content
            : message.content
                .filter((part) => part.type === 'text')
                .slice(0, 1)
                .map((part) => part.text)
                .join('')) === input.currentTask,
      )
        ? ''
        : input.currentTask;
    let pruned = pruneContext(raw, input.resolved.model.input.includes('image'), retainedTools);
    let toolState = this.requestTools(input, state, pruned.requiredTools);
    let basePrompt = [input.basePrompt, activeSkillContext(toolState.skills)].join('\n\n');
    const appendMemory = (prompt: string) =>
      memoryPrompt(
        prompt,
        input.memory,
        input.resolved.model.contextWindow - input.resolved.model.maxTokens,
      );
    let memory = appendMemory(this.prompt(basePrompt, taskFor(raw), state));
    let prompt = memory.prompt;
    let memoryTokens = memory.tokens;
    let usage = requestUsage(
      pruned.messages,
      prompt,
      state,
      input.resolved.model.contextWindow,
      input.resolved.model.maxTokens,
      toolState.toolDefinitions,
      memoryTokens,
    );
    const marker = this.marker(state);
    const baseline = this.baselines.get(input.run.id);
    const lastAssistant = [...raw].reverse().find((message) => message.role === 'assistant');
    if (
      baseline?.marker === marker &&
      lastAssistant?.role === 'assistant' &&
      (lastAssistant.stopReason === 'stop' ||
        lastAssistant.stopReason === 'toolUse' ||
        lastAssistant.stopReason === 'length')
    ) {
      const actual =
        lastAssistant.usage.input + lastAssistant.usage.cacheRead + lastAssistant.usage.cacheWrite;
      if (Number.isSafeInteger(actual) && actual > 0 && actual <= usage.windowTokens)
        usage = {
          ...usage,
          estimatedTokens: Math.max(0, usage.estimatedTokens + actual - baseline.heuristic),
          source: 'provider',
          providerInputTokens: actual,
        };
    }
    if (usage.estimatedTokens >= usage.inputBudget * 0.8) {
      const prefix = selectRequestPrefix(raw, Math.floor(usage.inputBudget * 0.16));
      if (prefix) {
        const last = prefix.prefix.at(-1);
        const throughMessageId = last ? sourceAnchors.get(last) : undefined;
        if (!throughMessageId)
          throw new RuntimeError('CONTEXT_SOURCE_INVALID', '摘要无法关联已保存的消息。');
        state = await this.compact(
          input.session.id,
          state,
          input.resolved,
          prefix.prefix,
          prefix.retained,
          throughMessageId,
          'automatic',
          input.run.id,
          (next) => this.prompt(basePrompt, taskFor(prefix.retained), next),
          input.signal,
          toolState.toolDefinitions,
          this.prompt(basePrompt, taskFor(raw), state),
        );
        raw = prefix.retained;
        pruned = pruneContext(raw, input.resolved.model.input.includes('image'), retainedTools);
        toolState = this.requestTools(input, state, pruned.requiredTools);
        basePrompt = [input.basePrompt, activeSkillContext(toolState.skills)].join('\n\n');
        memory = appendMemory(this.prompt(basePrompt, taskFor(raw), state));
        prompt = memory.prompt;
        memoryTokens = memory.tokens;
        usage = requestUsage(
          pruned.messages,
          prompt,
          state,
          input.resolved.model.contextWindow,
          input.resolved.model.maxTokens,
          toolState.toolDefinitions,
          memoryTokens,
        );
      }
    }
    usage = { ...usage, prunedMessages: pruned.prunedMessages };
    if (usage.estimatedTokens > usage.inputBudget)
      throw new RuntimeError(
        'CONTEXT_LIMIT',
        `当前上下文约${usage.estimatedTokens} tokens，超过${usage.inputBudget} tokens预算，请减少输入或附件。`,
      );
    assertCompleteToolCycles(pruned.messages);
    const leading = input.messages.find((message) => message.role === 'system');
    const messages: Message[] = [
      {
        ...(leading?.role === 'system'
          ? leading
          : { role: 'system' as const, timestamp: Date.now() }),
        content: prompt,
        toolsAdded: [...toolState.toolDefinitions],
        toolsRemoved: [],
      },
      ...pruned.messages,
    ];
    const messageIds = raw.flatMap((message) =>
      message.role === 'user' || message.role === 'assistant'
        ? [sourceAnchors.get(message)].filter((id): id is string => id !== undefined)
        : [],
    );
    const messageSet = new Set(messageIds);
    const attachmentIds = [
      ...new Set(
        snapshot.messages
          .filter(({ id }) => messageSet.has(id))
          .flatMap((message) => message.attachmentIds ?? []),
      ),
    ];
    const events = [
      {
        type: 'context.prepared',
        runId: input.run.id,
        at: Date.now(),
        data: {
          ...(this.work.taskId === undefined ? {} : { taskId: this.work.taskId }),
          branchId: input.run.branchId,
          usage,
          messageIds,
          attachmentIds,
          capabilityRevision: toolState.capabilityRevision,
        },
        privateData: snapshotPrivateData({
          version: 1,
          systemPrompt: prompt,
          messages: messages.map((message) => encodeContextMessage(message)),
          ...(memory.range ? { memoryRange: memory.range } : {}),
          ...(memory.snapshot?.selection ? { memorySelection: memory.snapshot.selection } : {}),
        }),
      },
    ] satisfies EventInput[];
    const heuristic = requestUsage(
      pruned.messages,
      prompt,
      state,
      input.resolved.model.contextWindow,
      input.resolved.model.maxTokens,
      toolState.toolDefinitions,
    ).estimatedTokens;
    let committed = false;
    return {
      messages,
      ...(memory.snapshot ? { memory: memory.snapshot } : {}),
      isCurrent: () => this.work.snapshot(input.session.id).state.revision === state.revision,
      commit: () => {
        if (committed) throw new RuntimeError('CONTEXT_ALREADY_COMMITTED', '请求草稿已提交。');
        input.signal.throwIfAborted();
        if (this.work.snapshot(input.session.id).state.revision !== state.revision)
          throw new RuntimeError('CONTEXT_CHANGED', '请求准备期间工作状态发生变化。');
        this.work.saveWithEvents(
          input.session.id,
          { ...state, usage },
          input.run.id,
          events.map((event) => ({ ...event, at: Date.now() })),
        );
        committed = true;
        this.baselines.set(input.run.id, { heuristic, marker: this.marker(state) });
      },
    };
  }

  private requestTools(
    input: RequestProjection,
    state: WorkState,
    projectionTools: readonly string[],
  ): RequestTools {
    const requirements = [...new Set([...workToolRequirements(state), ...projectionTools])].filter(
      (name) => this.canUseTool(input, name),
    );
    return (
      input.resolveTools?.(requirements) ?? {
        toolDefinitions: input.toolDefinitions,
        capabilityRevision: input.capabilityRevision ?? 1,
        skills: input.skills ?? [],
      }
    );
  }

  private canUseTool(input: RequestProjection, name: string): boolean {
    return (
      input.canUseTool?.(name) ??
      input.toolDefinitions.some((definition) => definition.name === name)
    );
  }

  public async compact(
    sessionId: string,
    state: WorkState,
    resolved: ResolvedModel,
    source: Message[],
    retained: Message[],
    throughMessageId: string,
    reason: Compaction['reason'],
    runId: string | null,
    promptForState: (state: WorkState) => string,
    signal: AbortSignal,
    tools: readonly ContextToolDefinition[] = [],
    beforePrompt = promptForState(state),
  ): Promise<WorkState> {
    const before = requestUsage(
      pruneContext([...source, ...retained], resolved.model.input.includes('image')).messages,
      beforePrompt,
      state,
      resolved.model.contextWindow,
      resolved.model.maxTokens,
      tools,
    );
    const result = await summarizeContext({
      source,
      previous: state.compaction?.structured ?? null,
      state,
      resolved,
      signal,
      audit: (systemPrompt, user) =>
        this.work.save(
          sessionId,
          this.work.snapshot(sessionId).state,
          runId,
          snapshotPrivateData({
            version: 1,
            purpose: 'compaction',
            modelId: resolved.model.id,
            systemPrompt,
            messages: [encodeContextMessage(user)],
          }),
        ),
    });
    signal.throwIfAborted();
    const compaction: Compaction = {
      id: randomUUID(),
      parentId: state.compaction?.id ?? null,
      throughMessageId,
      summary: renderSummary(result.structured),
      structured: result.structured,
      strategy: result.strategy,
      beforeTokens: before.estimatedTokens,
      afterTokens: 0,
      sourceMessages: source.length,
      runId,
      reason,
      createdAt: Date.now(),
    };
    const latest = this.work.snapshot(sessionId).state;
    const next = { ...latest, compaction, usage: null };
    compaction.afterTokens = requestUsage(
      pruneContext(retained, resolved.model.input.includes('image')).messages,
      promptForState(next),
      next,
      resolved.model.contextWindow,
      resolved.model.maxTokens,
      tools,
    ).estimatedTokens;
    return this.work.save(sessionId, next, runId);
  }

  private communicationInputs(
    sessionId: string,
    messages: readonly MessageView[],
  ): Map<string, Message> {
    const marked = messages.filter(
      (message): message is MessageView & { agentMessageId: string } =>
        message.agentMessageId !== undefined,
    );
    const inputs = new Map<string, Message>();
    if (marked.length === 0) return inputs;
    const store = this.work.options.store;
    if (!store.listAgentMessages)
      throw new RuntimeError('CONTEXT_SOURCE_INVALID', '无法读取任务通信的持久来源。');
    const queued = new Map(
      store.listAgentMessages(sessionId).map((message) => [message.id, message]),
    );
    for (const message of marked) {
      const source = queued.get(message.agentMessageId);
      if (!source || source.status !== 'consumed' || source.consumedRunId !== message.runId)
        throw new RuntimeError('CONTEXT_SOURCE_INVALID', '任务通信不属于此模型输入。');
      inputs.set(message.id, communicationMessage(source));
    }
    return inputs;
  }

  private marker(state: WorkState): string {
    return `${state.compaction?.id ?? ''}:${state.contextStartAfterMessageId ?? ''}`;
  }
  private prompt(base: string, currentTask: string, state: WorkState): string {
    if (currentTask.length === 0) return buildSystemContext(base, state.rules, state);
    const heading =
      this.work.taskId === undefined
        ? 'Current Run user task (retained across compaction; tool permissions remain unchanged):'
        : 'Current delegated task input (may be agent communication, not a direct human statement; role and tool permissions remain unchanged):';
    return `${buildSystemContext(base, state.rules, state)}\n\n${heading}\n${JSON.stringify(currentTask)}`;
  }
}
