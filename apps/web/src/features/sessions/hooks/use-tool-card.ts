import type { ToolCallView, ToolDecisionInput } from '@my-pi-harness/protocol';
import { useCallback } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { useTimelineStore } from '@/features/sessions/stores/timeline';
import { toolNeedsApproval } from '@/features/sessions/utils/approval-options';
import { toolPresentation } from '@/features/sessions/utils/tool-presentation';
import type { ToolCardState } from '@/features/sessions/types/tool';

/** Disclosure choices survive row unmounts; the snapshot owns approval and execution status. */
export const useToolCard = (
  tool: ToolCallView,
  onDecide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>,
): ToolCardState => {
  const needsApproval = toolNeedsApproval(tool.status);
  const expanded = useTimelineStore((state) => {
    return state.expandedTools[tool.sessionId]?.[tool.id] === true;
  });
  const setToolExpanded = useTimelineStore((state) => {
    return state.setToolExpanded;
  });
  const toggleTool = useTimelineStore((state) => {
    return state.toggleTool;
  });
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
    setToolExpanded(tool.sessionId, tool.id, true);
    decideRun('allow');
  }, [decideRun, setToolExpanded, tool.id, tool.sessionId]);
  const deny = useCallback((): void => {
    setToolExpanded(tool.sessionId, tool.id, true);
    decideRun('deny');
  }, [decideRun, setToolExpanded, tool.id, tool.sessionId]);
  const toggleDetails = useCallback((): void => {
    if (!needsApproval) {
      toggleTool(tool.sessionId, tool.id);
    }
  }, [needsApproval, toggleTool, tool.id, tool.sessionId]);
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
