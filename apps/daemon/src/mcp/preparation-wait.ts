/** A caller can stop waiting without cancelling preparation shared with startup or another Run. */
export async function waitForPreparation<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return await task;
  signal.throwIfAborted();
  let abort = (): void => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error ? reason : new DOMException('Catalog wait cancelled', 'AbortError'),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([task, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
