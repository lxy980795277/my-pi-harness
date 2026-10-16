import type { WorkSnapshot } from '@my-pi-harness/protocol';
import { useCallback, useState } from 'react';
import type { CompactionView, WorkDifference, SummaryRow } from '@/features/work/types/work';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  compareSummaries,
  compactionLabel,
  summaryRows,
  resolveCompaction,
} from '@/features/work/utils/context-view';

/** Selecting an older summary leaves the original log and all summary versions intact. */
export const useCompactions = (
  work: WorkSnapshot,
  onCommand: (name: string, input: unknown) => Promise<void>,
): CompactionView => {
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const latest = work.state.compaction;
  const left = resolveCompaction(work, leftId);
  const right = resolveCompaction(work, rightId);
  const action = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      if (!right) {
        return;
      }
      await onCommand(`compactions/${encodeURIComponent(right.id)}/select`, {
        expectedBranchId: work.state.branchId,
        revision: work.state.revision,
      });
      setConfirming(false);
    }, [onCommand, right, work.state.branchId, work.state.revision]),
  );
  const openConfirmation = useCallback((): void => {
    setConfirming(true);
  }, []);
  let selectedLeftId = '';
  let selectedRightId = '';
  let rows: WorkDifference[] | null = null;
  let summary: SummaryRow[] | null = null;
  let selected = right === null && latest === null;
  if (left !== null) {
    selectedLeftId = left.id;
  }
  if (right !== null) {
    selectedRightId = right.id;
    summary = summaryRows(right.structured);
    selected = latest !== null && right.id === latest.id;
    if (left !== null) {
      rows = compareSummaries(left, right);
    }
  }
  return {
    leftId: selectedLeftId,
    rightId: selectedRightId,
    setLeftId,
    setRightId,
    right,
    rows,
    summary,
    options: work.compactions.map((entry, index) => {
      return { value: entry.id, label: compactionLabel(entry, index) };
    }),
    action,
    confirming,
    setConfirming,
    openConfirmation,
    selected,
  };
};
