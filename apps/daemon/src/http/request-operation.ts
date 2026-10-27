import type { FastifyReply, FastifyRequest } from 'fastify';

type ResponseClosePolicy = 'writableEnded' | 'writableFinished' | 'always';

/**
 * Cancel request-owned work on disconnect; null leaves its deadline with the operation owner.
 * The close policy selects the response flag that suppresses cancellation, or every close.
 */
export async function requestOperation<T>(
  request: Pick<FastifyRequest, 'raw'>,
  reply: Pick<FastifyReply, 'raw'>,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number | null = 30_000,
  responseClosePolicy: ResponseClosePolicy = 'writableEnded',
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const close = (): void => {
    if (responseClosePolicy === 'always' || !reply.raw[responseClosePolicy]) controller.abort();
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
