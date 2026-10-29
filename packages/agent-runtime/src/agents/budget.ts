import type { AgentLimits } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors.js';

interface RequestWaiter {
  scopes: readonly AgentRequestScope[];
  enter(): void;
}

export interface AgentRequestScope {
  id: string;
  limit: number;
  concurrency?: number;
}

/** One root's shared request capacity and token reservations; child limits never allocate a second balance. */
export class AgentBudget {
  private active = 0;
  private spent = 0;
  private reserved = 0;
  private readonly waiters: RequestWaiter[] = [];
  private readonly taskSpent = new Map<string, number>();
  private readonly taskReserved = new Map<string, number>();
  private readonly taskActive = new Map<string, number>();

  public constructor(private readonly limits: AgentLimits) {}

  public async request(
    input: number,
    output: number,
    scopes: readonly AgentRequestScope[],
    signal: AbortSignal,
    enforce = true,
  ): Promise<(usage: number | undefined) => void> {
    signal.throwIfAborted();
    await this.enter(scopes, signal);
    const amount = input + output;
    try {
      signal.throwIfAborted();
      if (
        enforce &&
        (this.spent + this.reserved + amount > this.limits.tokenBudget ||
          scopes.some(
            (scope) =>
              (this.taskSpent.get(scope.id) ?? 0) +
                (this.taskReserved.get(scope.id) ?? 0) +
                amount >
              scope.limit,
          ))
      )
        throw new RuntimeError('AGENT_BUDGET', '任务树的剩余 token 预算不足以发起下一次请求。');
      this.reserved += amount;
      for (const scope of scopes)
        this.taskReserved.set(scope.id, (this.taskReserved.get(scope.id) ?? 0) + amount);
    } catch (error) {
      this.leave(scopes);
      throw error;
    }
    let settled = false;
    return (usage): void => {
      if (settled) return;
      settled = true;
      const cost = usage ?? amount;
      this.reserved -= amount;
      this.spent += cost;
      for (const scope of scopes) {
        this.taskReserved.set(scope.id, (this.taskReserved.get(scope.id) ?? 0) - amount);
        this.taskSpent.set(scope.id, (this.taskSpent.get(scope.id) ?? 0) + cost);
      }
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
    return scopes.every(
      (scope) =>
        (this.taskActive.get(scope.id) ?? 0) <
        (scope.concurrency ?? this.limits.maxConcurrentRequests),
    );
  }

  private drain(): void {
    while (this.active < this.limits.maxConcurrentRequests) {
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
