import type { FastifyReply, FastifyRequest } from 'fastify';

/** Request-owned work cancels on disconnect; null leaves its deadline with the operation owner. */
export async function requestOperation<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number | null = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const close = (): void => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', close);
  const timer = timeoutMs === null ? undefined : setTimeout(abort, timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', close);
  }
}
