import type { MessageView, ToolCallView } from '@my-pi-harness/protocol';

export type TimelineEntry =
  | { type: 'message'; id: string; createdAt: number; message: MessageView }
  | { type: 'tool'; id: string; createdAt: number; tool: ToolCallView };

/** Persisted message order and assistant anchors place tool activity independently of wall time. */
export const buildTimelineEntries = (
  messages: readonly MessageView[],
  tools: readonly ToolCallView[],
): TimelineEntry[] => {
  const toolsByMessage = new Map<string, ToolCallView[]>();
  for (const tool of tools) {
    const group = toolsByMessage.get(tool.afterMessageId);
    if (group) {
      group.push(tool);
    } else {
      toolsByMessage.set(tool.afterMessageId, [tool]);
    }
  }
  const entries: TimelineEntry[] = [];
  for (const message of messages) {
    entries.push({
      type: 'message',
      id: `message:${message.id}`,
      createdAt: message.createdAt,
      message,
    });
    for (const tool of toolsByMessage.get(message.id) ?? []) {
      entries.push({ type: 'tool', id: `tool:${tool.id}`, createdAt: tool.createdAt, tool });
    }
    toolsByMessage.delete(message.id);
  }
  if (toolsByMessage.size > 0) {
    throw new Error('工具调用缺少对应消息');
  }
  return entries;
};
