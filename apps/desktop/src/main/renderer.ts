import { setTimeout as delay } from 'node:timers/promises';

/**
 * Validate the local Web address before fetching or loading a desktop page.
 * @param value URL selected by the desktop configuration or daemon startup record.
 * @returns The absolute HTTP URL restricted to the local IPv4 interface.
 */
export function resolveRendererUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port === '0' ||
    url.username ||
    url.password
  ) {
    throw new Error('桌面 Web 地址必须使用本机 127.0.0.1 HTTP 服务');
  }
  return url.href;
}

/**
 * Wait for the controlled Vite server and cancel each request when desktop shutdown begins.
 * @param url Validated local development Web URL.
 * @param signal The desktop lifetime signal.
 */
export async function waitForRenderer(url: string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
        redirect: 'error',
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      signal.throwIfAborted();
      // The controlled Vite server can still be starting during desktop launch.
    }
    await delay(100, undefined, { signal });
  }
  throw new Error('Web 开发服务未就绪，请通过 pnpm dev:desktop 启动');
}
