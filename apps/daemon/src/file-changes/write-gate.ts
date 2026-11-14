import { FileChangeError } from './errors';

/** One profile owner serializes short native publications, including path aliases across sessions. */
export class FileWriteGate {
  private tail = Promise.resolve();
  private accepting = true;
  private readonly shutdown = new AbortController();
  private readonly active = new Set<Promise<unknown>>();

  public stopAccepting(): void {
    this.accepting = false;
    this.shutdown.abort();
  }

  public async run<T>(
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!this.accepting) throw new FileChangeError('FILE_CHANGE_CLOSED', '文件变更服务已关闭。');
    const combined = AbortSignal.any([signal, this.shutdown.signal]);
    const previous = this.tail;
    let release = (): void => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = (async () => {
      try {
        await previous;
        combined.throwIfAborted();
        return await operation(combined);
      } finally {
        release();
      }
    })();
    this.active.add(task);
    try {
      return await task;
    } finally {
      this.active.delete(task);
    }
  }

  /** Cancellation never releases a slot before the owning publication has settled. */
  public async close(): Promise<void> {
    this.stopAccepting();
    await Promise.allSettled(this.active);
  }
}
