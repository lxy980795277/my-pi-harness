import type { SessionUsage, UsageQuery } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import { useCallback, useId, useState } from 'react';
import { useUsage } from '@/features/usage/hooks/use-usage';
import {
  usageDuration,
  usageCost,
  usageFacts,
  usagePurposeLabel,
  usageText,
  usageTokenNumber,
  type UsageFact,
  type UsageText,
} from '@/features/usage/utils/usage-view';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface PurposeRow {
  purpose: string;
  calls: string;
  tokens: string;
  cost: string;
  duration: string;
}

interface ExternalServiceRow {
  service: string;
  calls: string;
}

interface UsagePanelState {
  query: UseQueryResult<SessionUsage, Error>;
  text: UsageText;
  facts: UsageFact[];
  purposes: PurposeRow[];
  externalServices: ExternalServiceRow[];
  externalOmittedLabel: string | null;
  includeDescendants: boolean;
  setIncludeDescendants: (include: boolean) => void;
  showScopeControl: boolean;
  toggleId: string;
  showDetails: boolean;
  toggleDetails: () => void;
  detailLabel: string;
  retry: () => void;
}

/** Task, trace and answer views use the same validated host accounting with explicit subtree selection. */
export const useUsagePanel = (
  sessionId: string,
  scope: UsageQuery,
  running: boolean,
  compact: boolean,
): UsagePanelState => {
  const [includeDescendants, setIncludeDescendants] = useState(scope.includeDescendants !== false);
  const [showDetails, setShowDetails] = useState(!compact);
  const toggleId = useId();
  const query = useUsage(sessionId, { ...scope, includeDescendants }, running);
  let scopeLabel = '所选执行范围';
  if (includeDescendants) scopeLabel += '，包含子任务';
  else scopeLabel += '，仅自身';
  const text = usageText(query.data, query.isPending, query.error, scopeLabel);
  const facts: UsageFact[] = [];
  const purposes: PurposeRow[] = [];
  const externalServices: ExternalServiceRow[] = [];
  let externalOmittedLabel: string | null = null;
  if (query.data !== undefined) {
    facts.push(...usageFacts(query.data, text));
    for (const purpose of query.data.byPurpose) {
      let tokens = '未记录';
      let cost = '未知';
      let duration = '未记录';
      if (purpose.recordedRequests > 0) {
        tokens = usageTokenNumber(purpose.tokens.totalTokens);
        if (purpose.recordedRequests < purpose.requestCount) tokens += '（部分）';
      }
      if (purpose.estimatedCostUsd !== null && purpose.estimatedRequests > 0) {
        cost = usageCost(purpose.estimatedCostUsd);
        if (purpose.estimatedRequests < purpose.requestCount) cost += '（部分）';
      }
      if (purpose.timedRequests > 0) {
        duration = usageDuration(purpose.modelDurationMs);
        if (purpose.unknownDurationRequests > 0) duration += '（部分）';
      }
      purposes.push({
        purpose: usagePurposeLabel(purpose.purpose),
        calls: purpose.recordedRequests + ' / ' + purpose.requestCount,
        tokens,
        cost,
        duration,
      });
    }
    for (const service of query.data.externalServices)
      externalServices.push({ service: service.service, calls: String(service.invocations) });
    if (query.data.externalServicesOmitted > 0)
      externalOmittedLabel =
        '另有 ' +
        query.data.externalServicesOmitted +
        ' 项服务、' +
        query.data.omittedExternalInvocations +
        ' 次工具调用未展开，费用未知';
  }
  const toggleDetails = useCallback((): void => {
    setShowDetails((current) => {
      return !current;
    });
  }, []);
  const { refetch } = query;
  const retry = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await refetch({ throwOnError: true });
    }, [refetch]),
  );
  let detailLabel = '展开统计';
  if (showDetails) detailLabel = '收起统计';
  return {
    query,
    text,
    facts,
    purposes,
    externalServices,
    externalOmittedLabel,
    includeDescendants,
    setIncludeDescendants,
    showScopeControl: scope.taskId !== undefined || scope.runId !== undefined,
    toggleId,
    showDetails,
    toggleDetails,
    detailLabel,
    retry: retry.run,
  };
};
