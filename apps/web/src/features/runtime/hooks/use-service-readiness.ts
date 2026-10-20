import { useCallback } from 'react';

import { useHealth } from '@/features/runtime/queries/health';
import type { RuntimeConnectionStatus } from '@/features/runtime/types/runtime';
import { describeHealthError } from '@/features/runtime/utils/health-error';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface ServiceReadiness {
  status: RuntimeConnectionStatus;
  message: string;
  retry: () => void;
}

/** Requires validated daemon health before commands and session subscriptions are available. */
export const useServiceReadiness = (): ServiceReadiness => {
  const health = useHealth();
  const { refetch } = health;
  const retry = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await refetch();
    }, [refetch]),
  );

  if (health.isPending || health.isFetching) {
    return { status: 'loading', message: '正在检查本机服务…', retry: retry.run };
  }

  if (health.isError) {
    return {
      status: 'error',
      message: describeHealthError(health.error),
      retry: retry.run,
    };
  }

  return { status: 'ready', message: '本机服务已连接。', retry: retry.run };
};
