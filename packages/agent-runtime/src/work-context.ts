import { randomUUID } from 'node:crypto';
import type { Message } from '@earendil-works/pi-ai';
import type {
  Compaction,
  MessageView,
  RunView,
  SessionSummary,
  WorkState,
} from '@my-pi-harness/protocol';
import type { ResolvedModel } from './model-gateway.js';
import type { WorkRuntime } from './work-runtime.js';
import { encodeContextMessage } from './context-codec.js';
import { contextSourceIds } from './context-sources.js';
import { buildSystemContext } from './context/system-context.js';
import { RuntimeError } from './errors.js';
import { pruneContext, requestUsage, selectRequestPrefix } from './context/projection.js';
import { renderSummary, summarizeContext } from './context/summary.js';
import { assertCompleteToolCycles, type ContextToolDefinition } from './context/budget.js';

export interface RequestProjection {
  session: SessionSummary;
  run: RunView;
  resolved: ResolvedModel;
  messages: Message[];
  basePrompt: string;
  currentTask: string;
  toolDefinitions: readonly ContextToolDefinition[];
  signal: AbortSignal;
}
interface RequestBaseline {
  heuristic: number;
  marker: string;
}

/** Associate SDK copies before pruning; tool results inherit their assistant message's durable anchor. */
function anchors(
  messages: readonly Message[],
  stored: readonly MessageView[],
): Map<Message, string> {
  const ids = contextSourceIds(messages, stored);
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

  public async project(input: RequestProjection): Promise<Message[]> {
    input.signal.throwIfAborted();
    const snapshot = this.work.options.store.getSnapshot(input.session.id);
    const sourceAnchors = anchors(input.messages, snapshot.messages);
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
    let prompt = this.prompt(input.basePrompt, taskFor(raw), state);
    let pruned = pruneContext(raw);
    let usage = requestUsage(
      pruned.messages,
      prompt,
      state,
      input.resolved.model.contextWindow,
      input.resolved.model.maxTokens,
      input.toolDefinitions,
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
          (next) => this.prompt(input.basePrompt, taskFor(prefix.retained), next),
          input.signal,
          input.toolDefinitions,
          prompt,
        );
        raw = prefix.retained;
        prompt = this.prompt(input.basePrompt, taskFor(raw), state);
        pruned = pruneContext(raw);
        usage = requestUsage(
          pruned.messages,
          prompt,
          state,
          input.resolved.model.contextWindow,
          input.resolved.model.maxTokens,
          input.toolDefinitions,
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
    this.work.save(input.session.id, { ...state, usage }, input.run.id);
    this.work.options.commit(input.session.id, [
      {
        type: 'context.prepared',
        runId: input.run.id,
        at: Date.now(),
        data: { branchId: input.run.branchId, usage, messageIds, attachmentIds },
        privateData: JSON.stringify({
          version: 1,
          systemPrompt: prompt,
          messages: messages.map(encodeContextMessage),
        }),
      },
    ]);
    const heuristic = requestUsage(
      pruned.messages,
      prompt,
      state,
      input.resolved.model.contextWindow,
      input.resolved.model.maxTokens,
      input.toolDefinitions,
    ).estimatedTokens;
    this.baselines.set(input.run.id, { heuristic, marker: this.marker(state) });
    return messages;
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
      pruneContext([...source, ...retained]).messages,
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
          JSON.stringify({
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
      pruneContext(retained).messages,
      promptForState(next),
      next,
      resolved.model.contextWindow,
      resolved.model.maxTokens,
      tools,
    ).estimatedTokens;
    return this.work.save(sessionId, next, runId);
  }

  private marker(state: WorkState): string {
    return `${state.compaction?.id ?? ''}:${state.contextStartAfterMessageId ?? ''}`;
  }
  private prompt(base: string, currentTask: string, state: WorkState): string {
    if (currentTask.length === 0) return buildSystemContext(base, state.rules, state);
    return `${buildSystemContext(base, state.rules, state)}\n\nCurrent Run user task (retained across compaction; tool permissions remain unchanged):\n${JSON.stringify(currentTask)}`;
  }
}
