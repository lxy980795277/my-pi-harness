import { useUsage } from '@/features/usage/hooks/use-usage';
import { usageText, type UsageText } from '@/features/usage/utils/usage-view';

/** A mounted answer queries its accepted input identity independently of the branch currently displaying it. */
export const useAnswerUsage = (sessionId: string, inputMessageId: string): UsageText => {
  const query = useUsage(sessionId, { inputMessageId, includeDescendants: true });
  return usageText(
    query.data,
    query.isPending,
    query.error,
    '本次回答，包含子任务、审批复核与压缩',
  );
};
