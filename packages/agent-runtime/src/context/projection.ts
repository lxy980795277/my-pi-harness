import type { Message } from '@earendil-works/pi-ai';
import type { ContextUsage, WorkState } from '@my-pi-harness/protocol';
import {
  assertCompleteToolCycles,
  estimateContextUsage,
  messageTokens,
  textTokens,
  type ContextToolDefinition,
} from './budget.js';

const TOOL_TEXT_LIMIT = 8192;
const ATTACHMENT_TEXT_LIMIT = 16_000;

/** Shorten model-visible copies only; durable messages and attachment bytes retain their full contents. */
export function pruneContext(messages: readonly Message[]): {
  messages: Message[];
  prunedMessages: number;
} {
  let prunedMessages = 0;
  let lastUser = -1;
  for (const [index, message] of messages.entries()) if (message.role === 'user') lastUser = index;
  const projected = messages.map((message, index): Message => {
    if (message.role === 'toolResult') {
      let changed = false;
      const content = message.content.map((part) => {
        if (part.type !== 'text' || part.text.length <= TOOL_TEXT_LIMIT) return part;
        changed = true;
        return {
          ...part,
          text: `${part.text.slice(0, 4096)}\n[Tool result shortened in model context; full result is retained in session history.]\n${part.text.slice(-1024)}`,
        };
      });
      if (changed) {
        prunedMessages += 1;
        return { ...message, content };
      }
    }
    if (message.role === 'user' && index < lastUser && typeof message.content !== 'string') {
      let changed = false;
      const content = message.content.map((part, partIndex) => {
        if (part.type === 'image') {
          changed = true;
          return {
            type: 'text' as const,
            text: '[Earlier image retained in its attachment; request its contents again if needed.]',
          };
        }
        if (partIndex > 0 && part.text.length > ATTACHMENT_TEXT_LIMIT) {
          changed = true;
          return {
            ...part,
            text: `${part.text.slice(0, ATTACHMENT_TEXT_LIMIT)}\n[Earlier attachment shortened; full attachment is retained.]`,
          };
        }
        return part;
      });
      if (changed) {
        prunedMessages += 1;
        return { ...message, content };
      }
    }
    return message;
  });
  return { messages: projected, prunedMessages };
}

/** Select an old prefix at a complete assistant/tool group, including within a single user task. */
export function selectRequestPrefix(
  messages: readonly Message[],
  tailTokens: number,
): { prefix: Message[]; retained: Message[] } | undefined {
  assertCompleteToolCycles(messages);
  const groups: Message[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role === 'system') continue;
    const group: Message[] = [message];
    if (message.role === 'assistant') {
      while (messages[index + 1]?.role === 'toolResult') {
        const next = messages[++index];
        if (next) group.push(next);
      }
    }
    groups.push(group);
  }
  if (groups.length < 2) return undefined;
  let retainedTokens = 0;
  let cutoff = groups.length - 1;
  for (; cutoff > 0; cutoff -= 1) {
    const group = groups[cutoff];
    if (group)
      retainedTokens += group.reduce((total, message) => total + messageTokens(message), 0);
    if (retainedTokens >= tailTokens) break;
  }
  if (cutoff < 1) cutoff = 1;
  return { prefix: groups.slice(0, cutoff).flat(), retained: groups.slice(cutoff).flat() };
}

/** Categories remain heuristic estimates even when the overall count is calibrated with provider usage. */
export function requestUsage(
  messages: readonly Message[],
  systemPrompt: string,
  state: WorkState,
  contextWindow: number,
  maxOutput: number,
  tools: readonly ContextToolDefinition[],
): ContextUsage {
  const usage = estimateContextUsage(
    messages.filter(({ role }) => role !== 'system'),
    systemPrompt,
    contextWindow,
    maxOutput,
    tools,
  );
  const rules = textTokens(
    JSON.stringify(state.rules.map(({ path, content }) => ({ path, content }))),
  );
  const summary = state.compaction ? textTokens(state.compaction.summary) : 0;
  const workingState = textTokens(
    JSON.stringify({ mode: state.mode, plan: state.plan, todos: state.todos }),
  );
  let attachments = 0;
  for (const message of messages) {
    if (message.role !== 'user' || typeof message.content === 'string') continue;
    for (const [index, part] of message.content.entries()) {
      if (index === 0 && part.type === 'text') continue;
      attachments += part.type === 'image' ? 4096 : textTokens(part.text);
    }
  }
  usage.categories = {
    ...usage.categories,
    system: Math.max(0, usage.categories.system - rules - summary - workingState),
    rules,
    summary,
    workingState,
    attachments,
    messages: Math.max(0, usage.categories.messages - attachments),
  };
  return usage;
}
