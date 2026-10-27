import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { waitForPreparation } from './preparation-wait.js';

/** Local file inspections remain owned until completion even after a caller stops waiting. */
export class LocalPreflights {
  private readonly stopping = new AbortController();
  private readonly tasks = new Set<Promise<unknown>>();

  public async prepare<T>(
    inspect: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (this.stopping.signal.aborted) throw new RuntimeError('MCP_CLOSED', 'MCP服务正在关闭。');
    const owned = AbortSignal.any([this.stopping.signal, AbortSignal.timeout(30_000)]);
    const task: Promise<T> = Promise.resolve().then(async () => {
      try {
        owned.throwIfAborted();
        const result = await inspect(owned);
        owned.throwIfAborted();
        return result;
      } finally {
        this.tasks.delete(task);
      }
    });
    this.tasks.add(task);
    const waiting = signal === undefined ? owned : AbortSignal.any([owned, signal]);
    try {
      return await waitForPreparation(task, waiting);
    } catch (error: unknown) {
      signal?.throwIfAborted();
      if (owned.aborted && !this.stopping.signal.aborted)
        throw new RuntimeError('MCP_PREPARATION_TIMEOUT', 'MCP程序与工作区检查超时，请重试。');
      throw error;
    }
  }
  public stop(): void {
    this.stopping.abort();
  }
  public async close(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.tasks]);
  }
}
