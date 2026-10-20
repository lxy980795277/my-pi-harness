import { HealthResponseSchema, type HealthResponse } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';

import { getJson } from '@/services/base-request';

/** Reads and validates daemon health through the same origin in both entry points. */
export const fetchHealth = async (signal: AbortSignal): Promise<HealthResponse> => {
  const data = await getJson('/health', signal);

  if (!Value.Check(HealthResponseSchema, data)) {
    throw new Error('本机服务与当前界面版本不兼容，请重启本机服务后重新连接。');
  }

  return data;
};
