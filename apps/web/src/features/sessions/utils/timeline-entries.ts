import type { MessageView, RunView, ToolCallView } from '@my-pi-harness/protocol';
import type { TimelineEntry } from '@/features/sessions/types/session';
import { buildAnswerFooters } from '@/features/sessions/utils/answer-metadata';
import { collapseAnswerProcesses } from '@/features/sessions/utils/answer-process';

const hasVisibleBody = (message: MessageView): boolean => {
  if (message.role !== 'assistant' || message.status !== 'complete') {
    return true;
  }
  if (message.text.length > 0) {
    return true;
  }
  return message.attachmentIds !== undefined && message.attachmentIds.length > 0;
};

const hasActiveActivity = (
  messages: readonly MessageView[],
  tools: readonly ToolCallView[],
  runId: string,
): boolean => {
  if (
    messages.some((message) => {
      return (
        message.runId === runId && message.role === 'assistant' && message.status === 'streaming'
      );
    })
  ) {
    return true;
  }
  return tools.some((tool) => {
    return (
      tool.runId === runId &&
      (tool.status === 'reviewing' ||
        tool.status === 'awaiting_approval' ||
        tool.status === 'running')
    );
  });
};

/** Preserves durable ordering and derives a temporary waiting row from the active run. */
export const buildTimelineEntries = (
  messages: readonly MessageView[],
  tools: readonly ToolCallView[],
  activeRunId: string | null,
  runs: readonly RunView[] = [],
  branchId?: string,
): TimelineEntry[] => {
  const answerFooters = buildAnswerFooters(messages, runs, activeRunId, branchId);
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
    const separateThinking = message.role === 'assistant' && message.thinking.length > 0;
    if (separateThinking) {
      entries.push({
        type: 'message',
        id: `thinking:${message.id}`,
        createdAt: message.createdAt,
        message,
        part: 'thinking',
      });
    }
    if (hasVisibleBody(message)) {
      const entry: TimelineEntry = {
        type: 'message',
        id: `message:${message.id}`,
        createdAt: message.createdAt,
        message,
      };
      if (separateThinking) entry.part = 'body';
      entries.push(entry);
    }
    for (const tool of toolsByMessage.get(message.id) ?? []) {
      entries.push({ type: 'tool', id: `tool:${tool.id}`, createdAt: tool.createdAt, tool });
    }
    toolsByMessage.delete(message.id);
    const footer = answerFooters.get(message.id);
    if (footer !== undefined) {
      entries.push({ type: 'answer-footer', id: `answer:${footer.inputId}`, footer });
    }
  }
  if (toolsByMessage.size > 0) {
    throw new Error('工具调用缺少对应消息');
  }
  if (activeRunId !== null && !hasActiveActivity(messages, tools, activeRunId)) {
    entries.push({ type: 'waiting', id: `waiting:${activeRunId}`, runId: activeRunId });
  }
  return collapseAnswerProcesses(entries, messages, runs, activeRunId, branchId);
};
