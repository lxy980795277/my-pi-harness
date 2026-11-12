import { useQuery } from '@tanstack/react-query';
import { MEMORY_SETTINGS_QUERY, useMemoryUsage } from '@/features/memory/hooks/use-memory-queries';
import { fetchMemoryStatuses } from '@/features/memory/services/memory';
import type {
  MemoryAdoptionView,
  MemoryOmissionView,
  MemoryUsageView,
} from '@/features/memory/types/memory';
import {
  memoryChangeLabel,
  memoryModeLabel,
  memoryOmissionLabel,
  memorySelectionLabel,
  memorySourceLabel,
  memoryVerificationLabel,
} from '@/features/memory/utils/memory-view';

/** Historical text and present state have independent queries and are never merged into one fact. */
export const useMemoryUsagePanel = (
  sessionId: string,
  runId: string | null,
  running: boolean,
): MemoryUsageView => {
  const query = useMemoryUsage(sessionId, runId, running);
  const ids = [
    ...new Set(
      (query.data?.entries ?? []).map((entry) => {
        return entry.id;
      }),
    ),
  ].sort();
  const current = useQuery({
    queryKey: ['memory-current', ids],
    queryFn: ({ signal }) => {
      return fetchMemoryStatuses(ids, signal);
    },
    enabled: ids.length > 0,
  });
  const settings = useQuery({ ...MEMORY_SETTINGS_QUERY, enabled: ids.length > 0 });
  const entries = (query.data?.entries ?? []).map((entry): MemoryAdoptionView => {
    const status = current.data?.find((value) => {
      return value.id === entry.id;
    });
    return {
      entry,
      sourceLabel: memorySourceLabel(entry.source),
      modeLabel: memoryModeLabel(entry.mode),
      changeLabel: memoryChangeLabel(entry, status, current.isError, settings.data?.allowUse),
    };
  });
  const selection = query.data?.selection;
  const omissions = (selection?.omissions ?? []).map((omission): MemoryOmissionView => {
    return {
      omission,
      modeLabel: memoryModeLabel(omission.mode),
      reasonLabel: memoryOmissionLabel(omission.reason),
    };
  });
  let selectionSummary: string | null = null;
  let moreOmissions = 0;
  if (selection !== undefined) {
    selectionSummary = `候选 ${selection.candidateCount} 项 · 匹配 ${selection.matchedCount} 项 · 未采用 ${selection.omittedCount} 项`;
    moreOmissions = Math.max(0, selection.omittedCount - selection.omissions.length);
  }
  return {
    query,
    entries,
    selectionLabel: memorySelectionLabel(selection),
    verificationLabel: memoryVerificationLabel(selection),
    selectionSummary,
    omissions,
    moreOmissions,
    incomplete: selection?.truncated === true,
  };
};
