import { API_PREFIX } from '@/constants/api.js';

/** Reads same-origin JSON with cancellation and a bounded response wait. */
export const getJson = async (path: string, signal: AbortSignal): Promise<unknown> => {
  const response = await fetch(`${API_PREFIX}${path}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`本机服务返回错误（HTTP ${response.status}），请检查服务后重试。`);
  }

  const data: unknown = await response.json();
  return data;
};
