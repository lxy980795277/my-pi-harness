import type { Message } from '@earendil-works/pi-ai';
import type { ContextUsage } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors.js';

export interface ContextToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ContextBudgetInput {
  messages: readonly Message[];
  systemPrompt: string;
  contextWindow: number;
  maxOutput: number;
  toolDefinitions?: readonly ContextToolDefinition[];
}

export interface FittedContext {
  messages: Message[];
  usage: ContextUsage;
}

/** Conservative Unicode/UTF-8 heuristic; this is not provider tokenization or billing usage. */
export function textTokens(text: string): number {
  let ascii = 0;
  let nonAsciiBytes = 0;
  for (const character of text) {
    if (character.charCodeAt(0) < 128) ascii += 1;
    else nonAsciiBytes += Buffer.byteLength(character, 'utf8');
  }
  return Math.ceil(ascii / 3 + nonAsciiBytes / 2);
}

export function messageTokens(message: Message): number {
  let tokens = 32;
  if (typeof message.content === 'string') tokens += textTokens(message.content);
  else {
    for (const part of message.content) {
      switch (part.type) {
        case 'text':
          tokens += textTokens(part.text);
          if (part.textSignature) tokens += textTokens(part.textSignature);
          break;
        case 'image':
          // Fixed image allowance is an estimate; provider resolution and tiling can differ.
          tokens += 4096 + textTokens(part.mimeType);
          break;
        case 'thinking':
          tokens += textTokens(part.thinking);
          if (part.thinkingSignature) tokens += textTokens(part.thinkingSignature);
          break;
        case 'toolCall':
          tokens += textTokens(part.id + part.name + JSON.stringify(part.arguments));
          if (part.thoughtSignature) tokens += textTokens(part.thoughtSignature);
          if (part.namespace) tokens += textTokens(part.namespace);
          break;
      }
    }
  }
  if (message.role === 'system') {
    if (message.sections) tokens += textTokens(JSON.stringify(message.sections));
    if (message.toolsAdded) tokens += textTokens(JSON.stringify(message.toolsAdded));
    if (message.toolsRemoved) tokens += textTokens(JSON.stringify(message.toolsRemoved));
  }
  if (message.role === 'toolResult') tokens += textTokens(message.toolCallId + message.toolName);
  return tokens;
}

/** Estimate model-visible messages, rules, tool declarations and protocol overhead. */
export function estimateContextUsage(
  messages: readonly Message[],
  systemPrompt: string,
  contextWindow: number,
  maxOutput: number,
  toolDefinitions: readonly ContextToolDefinition[] = [],
): ContextUsage {
  if (
    !Number.isSafeInteger(contextWindow) ||
    contextWindow < 1 ||
    !Number.isSafeInteger(maxOutput) ||
    maxOutput < 0 ||
    maxOutput >= contextWindow
  )
    throw new RuntimeError('INVALID_CONTEXT_BUDGET', '模型上下文窗口与输出预留配置无效。');
  let estimatedTokens = 256 + textTokens(systemPrompt);
  for (const message of messages) estimatedTokens += messageTokens(message);
  if (toolDefinitions.length > 0)
    estimatedTokens += textTokens(JSON.stringify(toolDefinitions)) + 32 * toolDefinitions.length;
  return {
    estimatedTokens,
    windowTokens: contextWindow,
    reservedOutput: maxOutput,
    inputBudget: contextWindow - maxOutput,
    trimmedMessages: 0,
    prunedMessages: 0,
    source: 'estimated',
    providerInputTokens: null,
    categories: {
      system: 256 + textTokens(systemPrompt),
      rules: 0,
      tools:
        toolDefinitions.length === 0
          ? 0
          : textTokens(JSON.stringify(toolDefinitions)) + 32 * toolDefinitions.length,
      messages: messages.reduce((total, message) => total + messageTokens(message), 0),
      attachments: 0,
      summary: 0,
      workingState: 0,
    },
  };
}

/** Reject orphan, duplicate or unfinished tool exchanges rather than sending partial cycles. */
export function assertCompleteToolCycles(messages: readonly Message[]): void {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'toolResult')
      throw new RuntimeError('CONTEXT_TOOL_PAIR', '上下文中存在未关联的工具结果。');
    if (message.role !== 'assistant') continue;
    const calls = message.content.filter((part) => part.type === 'toolCall');
    if (calls.length === 0) continue;
    const pending = new Map<string, string>();
    for (const call of calls) {
      if (pending.has(call.id))
        throw new RuntimeError('CONTEXT_TOOL_PAIR', '同一轮上下文中存在重复的工具调用。');
      pending.set(call.id, call.name);
    }
    let next = index + 1;
    while (messages[next]?.role === 'toolResult') {
      const result = messages[next];
      if (result?.role === 'toolResult') {
        if (pending.get(result.toolCallId) !== result.toolName)
          throw new RuntimeError('CONTEXT_TOOL_PAIR', '工具调用与结果不匹配。');
        pending.delete(result.toolCallId);
      }
      next += 1;
    }
    if (pending.size > 0)
      throw new RuntimeError('CONTEXT_TOOL_PAIR', '上下文中存在尚未完成的工具调用。');
    index = next - 1;
  }
}

/** Trim oldest complete user turns; preserve system updates and the entire latest user turn. */
export function fitContext(input: ContextBudgetInput): FittedContext {
  assertCompleteToolCycles(input.messages);
  const userStarts: number[] = [];
  for (const [index, message] of input.messages.entries()) {
    if (message.role === 'user') userStarts.push(index);
  }
  const usage = estimateContextUsage(
    input.messages,
    input.systemPrompt,
    input.contextWindow,
    input.maxOutput,
    input.toolDefinitions,
  );
  let cutoffIndex = 0;
  let estimatedTokens = usage.estimatedTokens;
  let trimmedMessages = 0;
  for (const cutoff of userStarts.slice(1)) {
    if (estimatedTokens <= usage.inputBudget) break;
    for (let index = cutoffIndex; index < cutoff; index += 1) {
      const message = input.messages[index];
      if (message && message.role !== 'system') {
        estimatedTokens -= messageTokens(message);
        trimmedMessages += 1;
      }
    }
    cutoffIndex = cutoff;
  }
  if (estimatedTokens > usage.inputBudget)
    throw new RuntimeError(
      'CONTEXT_LIMIT',
      '最新输入、项目规则或当前工具结果超过模型上下文预算，请缩短输入或减少附件。',
    );
  return {
    messages: input.messages.filter(
      (message, index) => index >= cutoffIndex || message.role === 'system',
    ),
    usage: { ...usage, estimatedTokens, trimmedMessages },
  };
}
