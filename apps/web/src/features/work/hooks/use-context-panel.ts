import type { RuleSource, WorkState } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useAsyncEvent, type AsyncEvent } from '@/hooks/use-async-event';
import { fetchWorkspaceRules } from '@/features/work/services/work';

interface ContextPanelState {
  compact: AsyncEvent<[]>;
  preview: boolean;
  togglePreview: () => void;
  rules: UseQueryResult<RuleSource[], Error>;
}
/** Latest workspace rules are an explicit preview, separate from the frozen run sources. */
export const useContextPanel = (
  state: WorkState,
  workspaceId: string | null,
  onCommand: (command: string, input: unknown) => Promise<void>,
): ContextPanelState => {
  const [preview, setPreview] = useState(false);
  const compact = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await onCommand('compact', { expectedBranchId: state.branchId, revision: state.revision });
    }, [onCommand, state.branchId, state.revision]),
  );
  const rules = useQuery({
    queryKey: ['workspace-rules', workspaceId],
    queryFn: ({ signal }): Promise<RuleSource[]> => {
      if (!workspaceId) {
        throw new Error('请先选择工作区。');
      }
      return fetchWorkspaceRules(workspaceId, signal);
    },
    enabled: preview && workspaceId !== null,
    staleTime: 0,
  });
  const togglePreview = useCallback((): void => {
    setPreview((value): boolean => {
      return !value;
    });
  }, []);
  return { compact, preview, togglePreview, rules };
};
