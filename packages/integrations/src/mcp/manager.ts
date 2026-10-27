import { Client } from '@modelcontextprotocol/client';
import { resolvePersistentProcess } from '@my-pi-harness/execution';
import { Value } from 'typebox/value';
import { discoverCatalog } from './catalog.js';
import { McpError } from './errors.js';
import { deepFreeze, fingerprint } from './fingerprint.js';
import { projectMcpResult } from './result.js';
import { CALL_META_KEY, SupervisedStdioTransport } from './stdio.js';
import type {
  McpCallInput,
  McpCallOutcome,
  McpCatalog,
  McpConnectionBinding,
  McpLaunchInput,
  McpLaunchPreview,
  McpLease,
} from './types.js';

interface Connection {
  binding: McpConnectionBinding;
  controller: AbortController;
  client: Client;
  transport: SupervisedStdioTransport | undefined;
  ready: Promise<McpCatalog>;
  references: number;
  calls: number;
  inFlight: Set<Promise<McpCallOutcome>>;
  invalid: boolean;
  closeTask: Promise<void> | undefined;
}

export interface McpConnectionManagerOptions {
  maximumConnections?: number;
  maximumCallsPerConnection?: number;
  maximumLeasesPerConnection?: number;
  startupDeadlineMs?: number;
  callDeadlineMs?: number;
}

function checkedLimit(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new McpError('INVALID_LIMIT', 'An MCP resource limit is invalid');
  return value;
}

/** Owns bounded connection leases. It never stores credentials, grants, sessions or JSONL facts. */
export class McpConnectionManager {
  #entries = new Map<string, Connection>();
  #closing = new Set<Connection>();
  #failedClosures = new Set<Connection>();
  #closed = false;
  #closeTask: Promise<void> | undefined;
  readonly #maximumConnections: number;
  readonly #maximumCalls: number;
  readonly #maximumLeases: number;
  readonly #startupDeadline: number;
  readonly #callDeadline: number;
  public constructor(options: McpConnectionManagerOptions = {}) {
    this.#maximumConnections = checkedLimit(options.maximumConnections, 8, 1, 32);
    this.#maximumCalls = checkedLimit(options.maximumCallsPerConnection, 8, 1, 32);
    this.#maximumLeases = checkedLimit(options.maximumLeasesPerConnection, 16, 1, 64);
    this.#startupDeadline = checkedLimit(options.startupDeadlineMs, 30000, 10, 120000);
    this.#callDeadline = checkedLimit(options.callDeadlineMs, 120000, 10, 600000);
  }

  public async previewLaunch(input: McpLaunchInput): Promise<McpLaunchPreview> {
    const launch = await resolvePersistentProcess(input);
    const secretNames = new Set(input.secretDescriptors.map((entry) => entry.environmentName));
    const environment = Object.fromEntries(
      Object.entries(input.environment).filter(([key]) => !secretNames.has(key)),
    );
    const startupFingerprint = fingerprint({
      command: launch.command,
      args: launch.args,
      workspaceRoot: launch.workspaceRoot,
      profileDirectory: launch.profileDirectory,
      scope: launch.scope,
      programIdentity: launch.programIdentity,
      argumentIdentities: launch.argumentIdentities,
      environment,
      secrets: input.secretDescriptors,
      protocol: 'legacy',
      network: launch.scope === 'sandboxed' ? 'denied' : 'host',
      limits: {
        frameBytes: 4194304,
        writeBytes: 4194304,
        stdoutBytes: 67108864,
        stderrBytes: 4194304,
        frameRate: 1024,
        frameBurst: 2048,
        frameCount: 65536,
      },
    });
    return { launch, startupFingerprint };
  }

  public hasActiveLeases(serverId: string): boolean {
    return [...this.#entries.values(), ...this.#closing, ...this.#failedClosures].some(
      (entry) =>
        entry.binding.serverId === serverId &&
        (entry.references > 0 || this.#closing.has(entry) || this.#failedClosures.has(entry)),
    );
  }

  public async discover(
    binding: McpConnectionBinding,
    options: { signal: AbortSignal },
  ): Promise<McpCatalog> {
    const lease = await this.acquire(binding, options);
    try {
      return lease.catalog;
    } finally {
      await lease.release();
    }
  }

  public async acquire(
    binding: McpConnectionBinding,
    options: { signal: AbortSignal },
  ): Promise<McpLease> {
    if (this.#closed || options.signal.aborted)
      throw new McpError('CANCELLED', 'The MCP lease was cancelled');
    const key = fingerprint({
      ownerId: binding.ownerId,
      identityEpoch: binding.identityEpoch,
      serverId: binding.serverId,
      serverRevision: binding.serverRevision,
      accessEpoch: binding.accessEpoch,
      credentialEpoch: binding.credentialEpoch,
      grantId: binding.grantId,
      startupFingerprint: binding.startupFingerprint,
      scope: binding.launch.scope,
      root: binding.launch.workspaceRoot,
    });
    let entry = this.#entries.get(key);
    if (entry?.invalid) throw new McpError('CONNECTION_REVOKED', 'The MCP connection was revoked');
    if (entry === undefined) {
      if (
        new Set([...this.#entries.values(), ...this.#closing, ...this.#failedClosures]).size >=
        this.#maximumConnections
      )
        throw new McpError('CONNECTION_LIMIT', 'The MCP connection limit was reached');
      entry = this.createConnection(binding);
      this.#entries.set(key, entry);
    }
    if (entry.references >= this.#maximumLeases)
      throw new McpError('LEASE_LIMIT', 'The MCP connection lease limit was reached');
    entry.references += 1;
    const owned = entry;
    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      owned.references -= 1;
      if (owned.references === 0) {
        if (this.#entries.get(key) === owned) this.#entries.delete(key);
        await this.closeConnection(owned);
      }
    };
    try {
      const catalog = await this.awaitReady(owned, options.signal);
      if (owned.invalid || options.signal.aborted || this.#closed)
        throw new McpError('CONNECTION_REVOKED', 'The MCP lease is no longer valid');
      return {
        catalog,
        release,
        call: async (input) => {
          if (released)
            return {
              kind: 'not-dispatched',
              cancelled: true,
              code: 'LEASE_RELEASED',
              message: 'The MCP lease was released',
            };
          const operation = this.call(owned, catalog, input);
          owned.inFlight.add(operation);
          try {
            return await operation;
          } finally {
            owned.inFlight.delete(operation);
          }
        },
      };
    } catch (error) {
      await release();
      throw error;
    }
  }

  private async awaitReady(entry: Connection, signal: AbortSignal): Promise<McpCatalog> {
    if (signal.aborted) throw new McpError('CANCELLED', 'The MCP lease was cancelled');
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_accept, reject) => {
      abort = () => {
        reject(new McpError('CANCELLED', 'The MCP lease was cancelled'));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([entry.ready, cancelled]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  private createConnection(binding: McpConnectionBinding): Connection {
    binding = deepFreeze(structuredClone(binding));
    const controller = new AbortController();
    const client = new Client(
      { name: 'my-pi-harness', version: '1' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'legacy' },
        inputRequired: { autoFulfill: false },
      },
    );
    const secrets = binding.launch.secretDescriptors
      .map((entry) => binding.launch.environment[entry.environmentName])
      .filter((value): value is string => value !== undefined && value.length > 0);
    // The start continuation sees the assigned connection before any external operation completes.
    const entry: Connection = {
      binding,
      controller,
      client,
      transport: undefined,
      ready: Promise.resolve({ tools: [] }),
      references: 0,
      calls: 0,
      inFlight: new Set(),
      invalid: false,
      closeTask: undefined,
    };
    entry.ready = (async () => {
      const deadline = new AbortController();
      const timer = setTimeout(() => {
        deadline.abort();
      }, this.#startupDeadline);
      const signal = AbortSignal.any([controller.signal, deadline.signal]);
      try {
        const preview = await this.previewLaunch(binding.launch);
        if (preview.startupFingerprint !== binding.startupFingerprint)
          throw new McpError(
            'STARTUP_CHANGED',
            'The MCP launch no longer matches its startup authorization',
          );
        if (signal.aborted) throw new McpError('CANCELLED', 'The MCP connection was cancelled');
        entry.transport = new SupervisedStdioTransport(preview.launch, secrets, () => {
          this.invalidateConnection(entry);
        });
        await client.connect(entry.transport, { signal, timeout: this.#startupDeadline });
        return await discoverCatalog(client, signal, secrets);
      } catch (error) {
        this.invalidateConnection(entry);
        if (error instanceof McpError) throw error;
        throw new McpError('CONNECTION_FAILED', 'The local MCP server could not be initialized');
      } finally {
        clearTimeout(timer);
      }
    })();
    entry.ready.catch(() => {});
    return entry;
  }

  private invalidateConnection(entry: Connection): void {
    if (entry.invalid) return;
    entry.invalid = true;
    entry.controller.abort();
    entry.transport?.close().catch(() => {});
  }

  private closeConnection(entry: Connection): Promise<void> {
    if (entry.closeTask) return entry.closeTask;
    this.invalidateConnection(entry);
    this.#closing.add(entry);
    entry.closeTask = (async () => {
      try {
        await entry.ready.catch(() => {});
        const failures: unknown[] = [];
        try {
          await entry.transport?.close();
        } catch (error) {
          failures.push(error);
        }
        try {
          await entry.client.close();
        } catch (error) {
          failures.push(error);
        }
        await Promise.allSettled([...entry.inFlight]);
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            'The local MCP connection could not be fully cleaned up',
          );
      } catch (error) {
        this.#failedClosures.add(entry);
        throw error;
      } finally {
        this.#closing.delete(entry);
      }
    })();
    return entry.closeTask;
  }

  private async call(
    entry: Connection,
    catalog: McpCatalog,
    input: McpCallInput,
  ): Promise<McpCallOutcome> {
    const transport = entry.transport;
    if (transport === undefined)
      return {
        kind: 'not-dispatched',
        cancelled: true,
        code: 'CONNECTION_NOT_READY',
        message: 'The MCP connection is not ready',
      };
    if (entry.invalid || entry.controller.signal.aborted || input.signal.aborted)
      return {
        kind: 'not-dispatched',
        cancelled: true,
        code: 'CONNECTION_REVOKED',
        message: 'The MCP connection is no longer available',
      };
    const tool = catalog.tools.find(
      (candidate) => candidate.remoteToolName === input.tool.remoteToolName,
    );
    if (
      !tool ||
      !tool.supported ||
      tool.parameters === null ||
      tool.definitionFingerprint !== input.tool.definitionFingerprint ||
      fingerprint(tool.definition) !== fingerprint(input.tool.definition)
    )
      return {
        kind: 'not-dispatched',
        cancelled: false,
        code: 'TOOL_CHANGED',
        message: 'The accepted MCP tool definition no longer matches the server',
      };
    if (!Value.Check(tool.parameters, input.arguments))
      return {
        kind: 'not-dispatched',
        cancelled: false,
        code: 'INVALID_ARGUMENTS',
        message: 'MCP tool arguments do not match the frozen definition',
      };
    if (entry.calls >= this.#maximumCalls)
      return {
        kind: 'not-dispatched',
        cancelled: false,
        code: 'CALL_LIMIT',
        message: 'The MCP connection request limit was reached',
      };
    const timeout = checkedLimit(input.deadlineMs, this.#callDeadline, 10, 600000);
    entry.calls += 1;
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort();
    }, timeout);
    const signal = AbortSignal.any([input.signal, entry.controller.signal, deadline.signal]);
    let attempt;
    try {
      attempt = transport.register({ ...input, tool }, signal);
    } catch (error) {
      clearTimeout(timer);
      entry.calls -= 1;
      throw error;
    }
    let result: McpCallOutcome | undefined;
    try {
      const response = await entry.client.callTool(
        {
          name: tool.remoteToolName,
          arguments: input.arguments,
          _meta: { [CALL_META_KEY]: { callAttemptId: input.callAttemptId } },
        },
        { signal, timeout, toolDefinition: tool.definition },
      );
      const secrets = entry.binding.launch.secretDescriptors
        .map((slot) => entry.binding.launch.environment[slot.environmentName])
        .filter((value): value is string => value !== undefined && value.length > 0);
      result = projectMcpResult(response, secrets);
    } catch {
      // The transport's observed stdin handoff, rather than an SDK exception, determines uncertainty.
    } finally {
      clearTimeout(timer);
      // A failed SDK request can leave stdin blocked; terminate the channel before waiting for its send task.
      if (result === undefined && attempt.written) this.invalidateConnection(entry);
      await transport.settle(attempt);
      entry.calls -= 1;
    }
    if (attempt.barrierError instanceof Error) throw attempt.barrierError;
    if (attempt.barrierError !== undefined)
      throw new McpError('BARRIER_FAILED', 'The tool dispatch could not be recorded');
    if (result !== undefined && attempt.written) return result;
    if (!attempt.written)
      return {
        kind: 'not-dispatched',
        cancelled: signal.aborted,
        code: signal.aborted ? 'CANCELLED' : 'CALL_FAILED',
        message: 'The MCP tool request was not written to the server',
      };
    this.invalidateConnection(entry);
    try {
      await transport.close();
    } catch {
      return {
        kind: 'unknown',
        code: 'PROCESS_CLEANUP_FAILED',
        message: '结果未知，操作可能已生效，需要核验；本地进程未能确认完整回收',
      };
    }
    return {
      kind: 'unknown',
      code: 'RESULT_UNKNOWN',
      message: '结果未知，操作可能已生效，需要核验',
    };
  }

  /** Invalidates old connections synchronously before awaiting their actual group/pipe cleanup. */
  public invalidateServer(serverId: string): Promise<void> {
    const entries = [
      ...new Set([...this.#entries.values(), ...this.#closing, ...this.#failedClosures]),
    ].filter((entry) => entry.binding.serverId === serverId);
    for (const entry of entries) this.invalidateConnection(entry);
    return this.finishInvalidation(entries);
  }

  private async finishInvalidation(entries: readonly Connection[]): Promise<void> {
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        await this.closeConnection(entry);
      }),
    );
    const failures = results
      .filter((entry) => entry.status === 'rejected')
      .map((entry): unknown => entry.reason);
    if (failures.length > 0)
      throw new AggregateError(failures, 'MCP connections could not be fully closed');
  }

  public close(): Promise<void> {
    if (this.#closeTask) return this.#closeTask;
    this.#closed = true;
    const entries = [
      ...new Set([...this.#entries.values(), ...this.#closing, ...this.#failedClosures]),
    ];
    for (const entry of entries) this.invalidateConnection(entry);
    this.#closeTask = this.finishInvalidation(entries);
    return this.#closeTask;
  }
}
