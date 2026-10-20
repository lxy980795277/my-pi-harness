import type { ToolCallView, ToolDecisionInput } from '@my-pi-harness/protocol';
import { useCallback, useState } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { toolNeedsApproval } from '@/features/sessions/utils/approval-options';
import { toolPresentation } from '@/features/sessions/utils/tool-presentation';
import type { ToolCardState } from '@/features/sessions/types/tool';

/** A decision is scoped to one durable call; the snapshot owns its resulting status. */
export const useToolCard = (
  tool: ToolCallView,
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>,
): ToolCardState => {
  const needsApproval = toolNeedsApproval(tool.status);
  const [expanded, setExpanded] = useState(needsApproval);
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
    setExpanded(true);
    decideRun('allow');
  }, [decideRun]);
  const deny = useCallback((): void => {
    setExpanded(true);
    decideRun('deny');
  }, [decideRun]);
  const toggleDetails = useCallback((): void => {
    setExpanded((open) => {
      return !open;
    });
  }, []);
  const detailsOpen = needsApproval || expanded;
  let detailsLabel = `展开 ${tool.name} 工具详情`;
  if (detailsOpen) {
    detailsLabel = `收起 ${tool.name} 工具详情`;
  }
  return {
    ...toolPresentation(tool),
    argumentsText: JSON.stringify(tool.arguments, null, 2),
    needsApproval,
    detailsOpen,
    detailsLabel,
    toggleDetails,
    allow,
    deny,
    pending: decision.pending,
    error: decision.error,
  };
};
