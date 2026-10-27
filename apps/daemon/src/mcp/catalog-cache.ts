import { decodeMcpCatalog, encodeMcpCatalog, type McpCatalog } from '@my-pi-harness/integrations';
import type { McpDirectoryRepository } from '@my-pi-harness/storage';
import type { ToolDiscoveryDiagnostic } from '@my-pi-harness/protocol';
import { catalogFailure } from './catalog-failure.js';
import { waitForPreparation } from './preparation-wait.js';

export interface CatalogEntry {
  authority: string;
  discoveredAt: number;
  value: McpCatalog;
}
interface Preparation<E> {
  key: string;
  serverId: string;
  scope: string;
  authority: string;
  before?(signal: AbortSignal): Promise<void>;
  assertCurrent(): void;
  restore(value: McpCatalog, discoveredAt: number): E;
  discover(signal: AbortSignal): Promise<unknown>;
}
interface Active {
  authority: string;
  controller: AbortController;
  signal: AbortSignal;
  task: Promise<void>;
}
type State = Pick<ToolDiscoveryDiagnostic, 'status' | 'error'>;

/** Rebuildable catalogs share bounded preparation, cancellation and finite diagnostics across consumers. */
export class CatalogCache<E extends CatalogEntry> {
  private readonly entries = new Map<string, E>();
  private readonly states = new Map<string, State>();
  private readonly active = new Map<string, Active>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly waiters: (() => void)[] = [];
  private running = 0;
  private closed = false;
  public constructor(
    private readonly repository: McpDirectoryRepository,
    private readonly report?: (serverId: string) => void,
  ) {}

  public get(key: string): E | undefined {
    return this.entries.get(key);
  }
  public state(key: string): State {
    return this.states.get(key) ?? { status: this.entries.has(key) ? 'ready' : 'idle' };
  }
  public fail(key: string, error?: unknown): void {
    this.entries.delete(key);
    this.states.set(key, {
      status: 'error',
      error: catalogFailure(error),
    });
  }
  public publish(key: string, serverId: string, scope: string, entry: E): void {
    this.repository.saveCatalog(serverId, scope, {
      authority: entry.authority,
      discoveredAt: entry.discoveredAt,
      data: encodeMcpCatalog(entry.value),
    });
    this.entries.set(key, entry);
    this.states.set(key, { status: 'ready' });
  }
  public delete(key: string, serverId = key, scope?: string): void {
    this.active.get(key)?.controller.abort();
    this.active.delete(key);
    this.entries.delete(key);
    this.states.delete(key);
    this.repository.removeCatalog(serverId, scope);
  }
  public clear(): void {
    for (const operation of this.active.values()) operation.controller.abort();
    this.active.clear();
    this.entries.clear();
    this.states.clear();
  }
  public async prepare(plan: Preparation<E>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.closed) throw new DOMException('MCP service is closing', 'AbortError');
    if (this.entries.get(plan.key)?.authority === plan.authority) return;
    let operation = this.active.get(plan.key);
    if (operation?.authority !== plan.authority) {
      operation?.controller.abort();
      const controller = new AbortController();
      operation = {
        authority: plan.authority,
        controller,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        task: Promise.resolve(),
      };
      this.active.set(plan.key, operation);
      this.states.set(plan.key, { status: 'loading' });
      operation.task = this.run(plan, operation);
      this.tasks.add(operation.task);
    }
    const waiting =
      signal === undefined ? operation.signal : AbortSignal.any([operation.signal, signal]);
    try {
      await waitForPreparation(operation.task, waiting);
    } catch (error: unknown) {
      signal?.throwIfAborted();
      if (!operation.signal.aborted) throw error;
      if (!operation.controller.signal.aborted && this.active.get(plan.key) === operation)
        this.failure(plan, error, true);
    }
  }
  public start(plan: Preparation<E>): void {
    if (this.closed) return;
    let task: Promise<void> = Promise.resolve();
    task = this.startOwned(plan, () => this.tasks.delete(task));
    this.tasks.add(task);
  }
  private async startOwned(plan: Preparation<E>, release: () => void): Promise<void> {
    try {
      await this.prepare(plan);
    } catch {
      /* Shutdown rejects new preparation; its owner has already recorded cancellation. */
    } finally {
      release();
    }
  }
  private async slot(signal: AbortSignal): Promise<() => void> {
    while (this.running >= 4) {
      let ready = (): void => undefined;
      const available = new Promise<void>((accept) => {
        ready = accept;
      });
      this.waiters.push(ready);
      try {
        await waitForPreparation(available, signal);
      } finally {
        const index = this.waiters.indexOf(ready);
        if (index !== -1) this.waiters.splice(index, 1);
        if (signal.aborted && this.running < 4) this.waiters.shift()?.();
      }
    }
    signal.throwIfAborted();
    this.running += 1;
    return () => {
      this.running -= 1;
      this.waiters.shift()?.();
    };
  }
  private async run(plan: Preparation<E>, operation: Active): Promise<void> {
    await Promise.resolve();
    const signal = operation.signal;
    let release = (): void => undefined;
    try {
      release = await this.slot(signal);
      await plan.before?.(signal);
      signal.throwIfAborted();
      plan.assertCurrent();
      let stored;
      try {
        stored = this.repository.catalog(plan.serverId, plan.scope);
      } catch {
        this.repository.removeCatalog(plan.serverId, plan.scope);
      }
      if (stored?.authority === plan.authority) {
        try {
          const catalog = decodeMcpCatalog(stored.data);
          signal.throwIfAborted();
          plan.assertCurrent();
          if (this.active.get(plan.key) !== operation) return;
          this.entries.set(plan.key, plan.restore(catalog, stored.discoveredAt));
          this.states.set(plan.key, { status: 'ready' });
          return;
        } catch {
          signal.throwIfAborted();
          this.repository.removeCatalog(plan.serverId, plan.scope);
        }
      }
      await plan.discover(signal);
      signal.throwIfAborted();
      plan.assertCurrent();
    } catch (error: unknown) {
      if (this.active.get(plan.key) !== operation) return;
      this.entries.delete(plan.key);
      if (operation.controller.signal.aborted) this.states.set(plan.key, { status: 'idle' });
      else this.failure(plan, error, signal.aborted);
    } finally {
      release();
      if (this.active.get(plan.key) === operation) this.active.delete(plan.key);
      this.tasks.delete(operation.task);
    }
  }
  private failure(plan: Preparation<E>, error: unknown, timedOut: boolean): void {
    const failure = catalogFailure(error, timedOut);
    const reported = this.states.get(plan.key)?.error?.code === failure.code;
    this.entries.delete(plan.key);
    this.states.set(plan.key, { status: 'error', error: failure });
    if (reported) return;
    try {
      this.report?.(plan.serverId);
    } catch {
      /* The safe failure remains visible even when a diagnostic sink is unavailable. */
    }
  }
  public stop(): void {
    this.closed = true;
    this.clear();
  }
  public async close(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.tasks]);
  }
}
