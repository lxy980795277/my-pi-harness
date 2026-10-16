import type { ToolCallView, ToolDecisionInput } from '@my-pi-harness/protocol';
import { useCallback } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { toolNeedsApproval } from '@/features/sessions/utils/approval-options';
import type { ToolCardState } from '@/features/sessions/types/composer';

const TOOL_STATUS_LABELS: Record<ToolCallView['status'], string> = {
  reviewing: 'AI 复核中',
  awaiting_approval: '等待批准',
  running: '执行中',
  completed: '已完成',
  failed: '执行失败',
  denied: '已拒绝',
  cancelled: '已取消',
  interrupted: '执行中断',
};

/** A decision is scoped to one durable call; the snapshot owns its resulting status. */
export const useToolCard = (
  tool: ToolCallView,
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>,
): ToolCardState => {
  const decision = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, value: ToolDecisionInput['decision']): Promise<void> => {
        await onDecide(tool.id, value);
      },
      [onDecide, tool.id],
    ),
  );
  const { run: decideRun } = decision;
  const allow = useCallback((): void => {
    decideRun('allow');
  }, [decideRun]);
  const deny = useCallback((): void => {
    decideRun('deny');
  }, [decideRun]);
  return {
    statusLabel: TOOL_STATUS_LABELS[tool.status],
    argumentsText: JSON.stringify(tool.arguments, null, 2),
    needsApproval: toolNeedsApproval(tool.status),
    allow,
    deny,
    pending: decision.pending,
    error: decision.error,
  };
};
