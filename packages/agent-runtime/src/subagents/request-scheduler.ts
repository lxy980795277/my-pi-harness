import { RuntimeError } from '../errors.js';

interface RequestWaiter {
  scopes: readonly AgentRequestScope[];
  enter(): void;
}

export interface AgentRequestScope {
  id: string;
  concurrency: number;
}

/** Share one root's model slots while enforcing each ancestor's subtree concurrency. */
export class AgentRequestScheduler {
  private active = 0;
  private readonly waiters: RequestWaiter[] = [];
  private readonly taskActive = new Map<string, number>();

  public constructor(private readonly maxConcurrentRequests: number) {}

  public async request(
    scopes: readonly AgentRequestScope[],
    signal: AbortSignal,
  ): Promise<() => void> {
    signal.throwIfAborted();
    await this.enter(scopes, signal);
    try {
      signal.throwIfAborted();
    } catch (error) {
      this.leave(scopes);
      throw error;
    }
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.leave(scopes);
    };
  }

  private enter(scopes: readonly AgentRequestScope[], signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: RequestWaiter = {
        scopes,
        enter: (): void => {
          signal.removeEventListener('abort', abort);
          this.active += 1;
          for (const scope of scopes)
            this.taskActive.set(scope.id, (this.taskActive.get(scope.id) ?? 0) + 1);
          resolve();
        },
      };
      const abort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        signal.removeEventListener('abort', abort);
        reject(new RuntimeError('AGENT_CANCELLED', '任务等待已取消。', { cause: signal.reason }));
        this.drain();
      };
      this.waiters.push(waiter);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else this.drain();
    });
  }

  private canEnter(scopes: readonly AgentRequestScope[]): boolean {
    return scopes.every((scope) => (this.taskActive.get(scope.id) ?? 0) < scope.concurrency);
  }

  private drain(): void {
    while (this.active < this.maxConcurrentRequests) {
      const index = this.waiters.findIndex((waiter) => this.canEnter(waiter.scopes));
      if (index === -1) return;
      const waiter = this.waiters.splice(index, 1)[0];
      waiter?.enter();
    }
  }

  private leave(scopes: readonly AgentRequestScope[]): void {
    this.active -= 1;
    for (const scope of scopes) {
      const next = (this.taskActive.get(scope.id) ?? 1) - 1;
      if (next === 0) this.taskActive.delete(scope.id);
      else this.taskActive.set(scope.id, next);
    }
    this.drain();
  }
}
