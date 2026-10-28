import { useCallback } from 'react';
import type { ApprovalMode, McpToolSelection } from '@my-pi-harness/protocol';
import { useComposerStore } from '@/features/sessions/stores/composer';
import { useMcpSelection } from '@/features/mcp/hooks/use-mcp-selection';
import { EMPTY_MCP_SELECTIONS } from '@/features/mcp/utils/mcp-selection';
import type { McpSelectionState } from '@/features/mcp/types/mcp';

/** Main drafts survive navigation; submitted attempts and active runs override them with frozen choices. */
export const useComposerMcpSelection = (
  draftKey: string,
  workspaceId: string | null,
  approval: ApprovalMode,
  locked: boolean,
  frozen: McpToolSelection[] | undefined = undefined,
): McpSelectionState => {
  const stored = useComposerStore((state) => {
    return state.mcpSelections[draftKey] ?? EMPTY_MCP_SELECTIONS;
  });
  const setSelections = useComposerStore((state) => {
    return state.setMcpSelections;
  });
  const changeSelection = useCallback(
    (tools: McpToolSelection[]): void => {
      setSelections(draftKey, tools);
    },
    [draftKey, setSelections],
  );
  return useMcpSelection(frozen ?? stored, changeSelection, workspaceId, approval, locked);
};
