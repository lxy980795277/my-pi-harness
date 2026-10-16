import type { EventConnection, RuntimeConnection } from '@/features/runtime/types/runtime';
import { useCallback, useEffect, useState } from 'react';

import { useHealth } from '@/features/runtime/queries/health';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { subscribeToRuntime } from '@/features/runtime/services/runtime-events';

const describeHealthError = (error: Error): string => {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return '本机服务响应超时，请检查服务后重试。';
  }

  if (error instanceof TypeError) {
    return '无法连接本机服务，请确认 daemon 已启动后重试。';
  }

  if (error instanceof SyntaxError) {
    return '本机服务返回了无法解析的数据，请确认服务版本后重试。';
  }

  return error.message;
};

/** Owns the health request and its matching SSE subscription, including cleanup. */
export const useRuntimeConnection = (): RuntimeConnection => {
  const healthQuery = useHealth();
  const { refetch } = healthQuery;
  const [connection, setConnection] = useState<EventConnection>({ status: 'loading' });

  useEffect(() => {
    if (!healthQuery.isSuccess || healthQuery.isFetching) {
      return;
    }

    return subscribeToRuntime(healthQuery.data, {
      onReady: (event): void => {
        setConnection({ status: 'ready', event });
      },
      onError: (message): void => {
        setConnection({ status: 'error', message });
      },
    });
  }, [healthQuery.data, healthQuery.isSuccess, healthQuery.isFetching]);

  const retryEvent = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      setConnection({ status: 'loading' });
      await refetch();
    }, [refetch]),
  );
  const retry = retryEvent.run;

  const health = healthQuery.data;

  if (healthQuery.isPending || healthQuery.isFetching) {
    return { status: 'loading', message: '正在检查本机服务…', health, event: undefined, retry };
  }

  if (healthQuery.isError) {
    return {
      status: 'error',
      message: describeHealthError(healthQuery.error),
      health: undefined,
      event: undefined,
      retry,
    };
  }

  if (connection.status === 'error') {
    return { status: 'error', message: connection.message, health, event: undefined, retry };
  }

  if (connection.status === 'ready') {
    return {
      status: 'ready',
      message: '健康检查与事件连接正常。',
      health,
      event: connection.event,
      retry,
    };
  }

  return {
    status: 'loading',
    message: '本机服务已响应，正在建立事件连接…',
    health,
    event: undefined,
    retry,
  };
};
