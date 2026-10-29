import type { Message } from '@earendil-works/pi-ai';
import type { MessageView } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors.js';

/** Resolve the retained message suffix back to durable IDs without reading attachment bytes again. */
export function contextSourceIds(
  messages: readonly Message[],
  stored: readonly MessageView[],
  originalInputs: ReadonlyMap<string, Message> = new Map(),
): string[] {
  const selected = new Set<string>();
  let cursor = stored.length - 1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    const text = messageText(message);
    let matched = false;
    for (; cursor >= 0; cursor -= 1) {
      const candidate = stored[cursor];
      if (candidate?.status !== 'complete' || candidate.role !== message.role) continue;
      const original = originalInputs.get(candidate.id);
      if (candidate.agentMessageId !== undefined && original === undefined)
        throw new RuntimeError('CONTEXT_SOURCE_INVALID', '任务通信缺少原始输入来源。');
      const sourceText = original === undefined ? candidate.text : messageText(original);
      if (sourceText === text) {
        selected.add(candidate.id);
        cursor -= 1;
        matched = true;
        break;
      }
    }
    if (!matched)
      throw new RuntimeError('CONTEXT_SOURCE_INVALID', '模型输入无法关联到已保存的消息。');
  }
  return stored.filter(({ id }) => selected.has(id)).map(({ id }) => id);
}

function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  if (message.role === 'user') {
    const first = message.content[0];
    return first?.type === 'text' ? first.text : '';
  }
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
