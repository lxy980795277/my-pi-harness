import { NetworkError } from '../network/errors.js';
import {
  Client,
  StreamableHTTPClientTransport,
  SSEClientTransport,
  UnauthorizedError,
  InsufficientScopeError,
  SdkHttpError,
  SseError,
  type Transport,
  type FetchLike,
} from '@modelcontextprotocol/client';
import { Value } from 'typebox/value';
import { Type } from 'typebox';
import { discoverCatalog } from './catalog.js';
import { McpError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import { projectMcpResult } from './result.js';
import { createRemoteFetch, parseRemoteUrl } from '../network/remote-fetch.js';
import type { McpCallInput, McpCallOutcome, McpCatalog, McpLease } from './types.js';

export interface RemoteMcpBinding {
  serverId: string;
  endpoint: string;
  transport: 'streamable-http' | 'sse';
  headers: Readonly<Record<string, string>>;
  secrets: readonly string[];
  authorizationKey: string;
}

interface Attempt {
  input: McpCallInput;
  signal: AbortSignal;
  started: boolean;
  barrier: Promise<void> | undefined;
  error: unknown;
}

export interface RemoteMcpManagerOptions {
  fixtureOrigin?: string;
  fetch?: FetchLike;
  startupDeadlineMs?: number;
}

const RequestSchema = Type.Object({
  method: Type.String(),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const metaKey = 'my-pi-harness/call';

/** Each lease owns a fresh SDK connection; failed requests are never replayed on a replacement. */
export class RemoteMcpManager {
  private readonly active = new Map<
    AbortController,
    { serverId: string; close: () => Promise<void> }
  >();
  private stopped = false;
  public constructor(private readonly options: RemoteMcpManagerOptions = {}) {}
  public hasActiveLeases(serverId: string): boolean {
    return [...this.active.values()].some((entry) => entry.serverId === serverId);
  }
  public async discover(
    binding: RemoteMcpBinding,
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
    binding: RemoteMcpBinding,
    options: { signal: AbortSignal },
  ): Promise<McpLease> {
    if (this.stopped || options.signal.aborted)
      throw new McpError('CANCELLED', '远程MCP连接已取消。');
    if (this.active.size >= 8) throw new McpError('CONNECTION_LIMIT', '远程MCP连接数量超过限制。');
    const endpoint = parseRemoteUrl(binding.endpoint, this.options.fixtureOrigin);
    const controller = new AbortController();
    const attempts = new Map<string, Attempt>();
    const usedAttempts = new Set<string>();
    const ownedSignal = AbortSignal.any([controller.signal, options.signal]);
    const beforeRequest = async (_url: URL, init: RequestInit): Promise<void> => {
      if (init.method !== 'POST' || typeof init.body !== 'string') return;
      let request: unknown;
      try {
        request = JSON.parse(init.body);
      } catch {
        throw new McpError('INVALID_REQUEST', 'SDK请求正文无效。');
      }
      if (!Value.Check(RequestSchema, request) || request.method !== 'tools/call') return;
      const meta = request.params?.['_meta'];
      const MetaSchema = Type.Object({ [metaKey]: Type.Object({ callAttemptId: Type.String() }) });
      if (!Value.Check(MetaSchema, meta))
        throw new McpError('CALL_ID_REQUIRED', '外部调用缺少宿主attempt。');
      const key = meta[metaKey].callAttemptId;
      const attempt = attempts.get(key);
      if (attempt === undefined || attempt.started || attempt.barrier !== undefined)
        throw new McpError('REPLAY_FORBIDDEN', '外部调用不允许自动重发。');
      if (
        request.params?.['name'] !== attempt.input.tool.remoteToolName ||
        fingerprint(request.params?.['arguments']) !== fingerprint(attempt.input.arguments)
      )
        throw new McpError('CALL_CHANGED', '外部调用与冻结参数不一致。');
      attempt.barrier = (async () => {
        try {
          attempt.signal.throwIfAborted();
          await attempt.input.beforeDispatch();
          attempt.signal.throwIfAborted();
          attempt.started = true;
        } catch (error) {
          attempt.error = error;
          throw error;
        }
      })();
      await attempt.barrier;
    };
    const fetch = createRemoteFetch({
      ...(this.options.fixtureOrigin === undefined
        ? {}
        : { fixtureOrigin: this.options.fixtureOrigin }),
      signal: ownedSignal,
      allowedOrigins: new Set([endpoint.origin]),
      beforeRequest,
      validateUtf8: true,
    });
    const headers = { ...binding.headers };
    let transport: Transport;
    if (binding.transport === 'streamable-http') {
      transport = new StreamableHTTPClientTransport(endpoint, {
        fetch,
        requestInit: { headers, redirect: 'error' },
        reconnectionOptions: {
          maxRetries: 0,
          initialReconnectionDelay: 1000,
          maxReconnectionDelay: 1000,
          reconnectionDelayGrowFactor: 1,
        },
        onInsufficientScope: 'throw',
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Explicit legacy SSE compatibility uses the SDK adapter; new servers use Streamable HTTP.
      transport = new SSEClientTransport(endpoint, {
        fetch,
        requestInit: { headers, redirect: 'error' },
        redirectPolicy: 'same-origin',
      });
    }
    const client = new Client(
      { name: 'my-pi-harness', version: '1' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'legacy' },
        inputRequired: { autoFulfill: false },
      },
    );
    let closeTask: Promise<void> | undefined;
    const pending = new Set<Promise<McpCallOutcome>>();
    const release = (): Promise<void> => {
      closeTask ??= (async () => {
        controller.abort();
        await transport.close();
        await client.close();
        await Promise.allSettled([...pending]);
        this.active.delete(controller);
      })();
      return closeTask;
    };
    this.active.set(controller, { serverId: binding.serverId, close: release });
    let catalog: McpCatalog;
    try {
      const startupDeadline = this.options.startupDeadlineMs ?? 30000;
      const startup = AbortSignal.any([ownedSignal, AbortSignal.timeout(startupDeadline)]);
      await client.connect(transport, { signal: startup, timeout: startupDeadline });
      catalog = await discoverCatalog(client, startup, binding.secrets);
    } catch (error) {
      await release();
      if (error instanceof McpError || error instanceof NetworkError) throw error;
      if (
        error instanceof UnauthorizedError ||
        error instanceof InsufficientScopeError ||
        (error instanceof SdkHttpError && (error.status === 401 || error.status === 403)) ||
        (error instanceof SseError && (error.code === 401 || error.code === 403))
      )
        throw new McpError(
          'AUTHENTICATION_REQUIRED',
          '远端MCP认证失败或权限不足，请检查Header或先完成账户授权。',
        );
      throw new McpError('REMOTE_CONNECTION_FAILED', '远程MCP初始化或目录发现失败。');
    }
    const call = async (input: McpCallInput): Promise<McpCallOutcome> => {
      const tool = catalog.tools.find(
        (entry) => entry.remoteToolName === input.tool.remoteToolName,
      );
      if (
        tool === undefined ||
        tool.parameters === null ||
        !tool.supported ||
        tool.definitionFingerprint !== input.tool.definitionFingerprint ||
        fingerprint(tool.definition) !== fingerprint(input.tool.definition) ||
        !Value.Check(tool.parameters, input.arguments)
      )
        return {
          kind: 'not-dispatched',
          cancelled: false,
          code: 'TOOL_CHANGED',
          message: '工具定义或参数与冻结目录不一致。',
        };
      if (closeTask !== undefined || controller.signal.aborted || input.signal.aborted)
        return {
          kind: 'not-dispatched',
          cancelled: true,
          code: 'CANCELLED',
          message: '远程调用已取消。',
        };
      if (pending.size >= 8 || usedAttempts.size >= 64)
        return {
          kind: 'not-dispatched',
          cancelled: false,
          code: 'CALL_LIMIT',
          message: '远程租约请求数量超过限制。',
        };
      if (usedAttempts.has(input.callAttemptId))
        throw new McpError('REPLAY_FORBIDDEN', '调用attempt不能重复使用。');
      const timeout = input.deadlineMs ?? 120000;
      const signal = AbortSignal.any([ownedSignal, input.signal, AbortSignal.timeout(timeout)]);
      const attempt: Attempt = {
        input,
        signal,
        started: false,
        barrier: undefined,
        error: undefined,
      };
      usedAttempts.add(input.callAttemptId);
      attempts.set(input.callAttemptId, attempt);
      let outcome: McpCallOutcome | undefined;
      try {
        const result = await client.callTool(
          {
            name: tool.remoteToolName,
            arguments: input.arguments,
            _meta: { [metaKey]: { callAttemptId: input.callAttemptId } },
          },
          { signal, timeout, toolDefinition: tool.definition },
        );
        outcome = projectMcpResult(result, binding.secrets);
      } catch {
        /* The observed HTTP dispatch barrier determines uncertainty. */
      }
      await attempt.barrier?.catch(() => {});
      if (attempt.error instanceof Error) throw attempt.error;
      if (attempt.error !== undefined) throw new McpError('BARRIER_FAILED', '派发屏障无法提交。');
      if (outcome !== undefined && attempt.started) return outcome;
      if (!attempt.started)
        return {
          kind: 'not-dispatched',
          cancelled: signal.aborted,
          code: signal.aborted ? 'CANCELLED' : 'CALL_FAILED',
          message: '远程工具请求未派发。',
        };
      controller.abort();
      await transport.close();
      return {
        kind: 'unknown',
        code: 'RESULT_UNKNOWN',
        message: '结果未知，操作可能已生效，需要核验。',
      };
    };
    return {
      catalog,
      release,
      call: (input) => {
        const task = call(input);
        pending.add(task);
        return task.finally(() => {
          pending.delete(task);
          attempts.delete(input.callAttemptId);
        });
      },
    };
  }
  public async invalidateServer(serverId: string): Promise<void> {
    const entries = [...this.active].filter(([, entry]) => entry.serverId === serverId);
    for (const [controller] of entries) controller.abort();
    await Promise.all(entries.map(([, entry]) => entry.close()));
  }
  public async close(): Promise<void> {
    this.stopped = true;
    for (const controller of this.active.keys()) controller.abort();
    await Promise.all([...this.active.values()].map((entry) => entry.close()));
  }
}
