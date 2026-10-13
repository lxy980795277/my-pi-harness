import { RuntimeReadyEventSchema, type HealthResponse } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';

import type { RuntimeSubscription } from '@/features/runtime/types/runtime-subscription.js';
import { subscribeSse } from '@/services/base-sse.js';

/** Validates SSE payloads and ensures health and events describe the same daemon. */
export const subscribeToRuntime = (
  health: HealthResponse,
  { onReady, onError }: RuntimeSubscription,
): (() => void) => {
  const fail = (message: string): void => {
    window.clearTimeout(readyTimeout);
    closeStream();
    onError(message);
  };

  const readyTimeout = window.setTimeout((): void => {
    fail('事件连接未返回就绪信号，请检查本机服务后重试。');
  }, 8_000);

  const receiveReady = (event: Event): void => {
    if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
      fail('本机服务发送了无法识别的事件，请重试。');
      return;
    }

    let payload: unknown;

    try {
      payload = JSON.parse(event.data);
    } catch {
      fail('本机服务的事件内容不是有效 JSON，请重试。');
      return;
    }

    if (!Value.Check(RuntimeReadyEventSchema, payload)) {
      fail('本机服务的事件版本不兼容，请确认前后端版本一致。');
      return;
    }

    if (payload.instanceId !== health.instanceId || payload.startedAt !== health.startedAt) {
      fail('本机服务已重启，请重新连接以读取当前状态。');
      return;
    }

    window.clearTimeout(readyTimeout);
    onReady(payload);
  };

  const onDisconnect = (): void => {
    fail('事件连接已断开，请检查本机服务后重试。');
  };

  const closeStream = subscribeSse('/runtime/events', 'runtime.ready', receiveReady, onDisconnect);

  return (): void => {
    window.clearTimeout(readyTimeout);
    closeStream();
  };
};
