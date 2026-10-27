import {
  deserializeMessage,
  serializeMessage,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/client';
import {
  startPersistentProcess,
  type PersistentProcess,
  type PersistentProcessLaunch,
} from '@my-pi-harness/execution';
import { McpError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import type { McpCallInput } from './types.js';

export interface DispatchAttempt {
  readonly id: string;
  readonly input: McpCallInput;
  readonly signal: AbortSignal;
  readonly sends: Set<Promise<void>>;
  used: boolean;
  revoked: boolean;
  barrier: boolean;
  written: boolean;
  barrierError: unknown;
}

const MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const CALL_META_KEY = 'my-pi-harness/call';

/** Strict framing uses the official decoder; business identity never depends on SDK wire ids. */
export class SupervisedStdioTransport implements Transport {
  public onclose: Transport['onclose'];
  public onerror: Transport['onerror'];
  public onmessage: Transport['onmessage'];
  #process: PersistentProcess | undefined;
  #buffer = Buffer.alloc(0);
  #controller = new AbortController();
  #attempts = new Map<string, DispatchAttempt>();
  #attemptIds = new Set<string>();
  #closed: Promise<void> | undefined;
  #started = false;
  #frameTokens = 2048;
  #frameTime = performance.now();
  #frameCount = 0;
  #failed = false;
  public constructor(
    private readonly launch: PersistentProcessLaunch,
    private readonly secrets: readonly string[],
    private readonly onFault: () => void,
  ) {}

  public async start(): Promise<void> {
    if (this.#started)
      throw new McpError('ALREADY_STARTED', 'The local connection already started');
    this.#started = true;
    this.#process = await startPersistentProcess(
      this.launch,
      {
        stdout: (chunk) => {
          this.receive(chunk);
        },
        stdoutEnd: () => {
          if (this.#buffer.length !== 0)
            this.fail('INCOMPLETE_FRAME', 'Local tool stdout ended within a protocol frame');
        },
        fault: () => {
          this.fail('CONNECTION_LOST', 'The local tool connection closed unexpectedly');
        },
      },
      this.#controller.signal,
      this.secrets,
    );
    if (this.#controller.signal.aborted) await this.#process.close();
  }

  public register(input: McpCallInput, signal: AbortSignal): DispatchAttempt {
    if (this.#attemptIds.has(input.callAttemptId))
      throw new McpError('DUPLICATE_ATTEMPT', 'The call attempt already exists');
    if (this.#attemptIds.size >= 4096)
      throw new McpError('ATTEMPT_LIMIT', 'The connection call-attempt limit was reached');
    this.#attemptIds.add(input.callAttemptId);
    const attempt: DispatchAttempt = {
      id: input.callAttemptId,
      input,
      signal,
      sends: new Set(),
      used: false,
      revoked: false,
      barrier: false,
      written: false,
      barrierError: undefined,
    };
    this.#attempts.set(attempt.id, attempt);
    return attempt;
  }

  public async settle(attempt: DispatchAttempt): Promise<void> {
    attempt.revoked = true;
    await Promise.allSettled([...attempt.sends]);
    this.#attempts.delete(attempt.id);
  }

  public async send(message: JSONRPCMessage): Promise<void> {
    if ('method' in message && message.method === 'tools/call') {
      const params = message.params;
      const metadata = params?.['_meta'];
      const identity =
        typeof metadata === 'object' && metadata !== null ? metadata[CALL_META_KEY] : undefined;
      const id =
        typeof identity === 'object' && identity !== null && 'callAttemptId' in identity
          ? identity.callAttemptId
          : undefined;
      const attempt = typeof id === 'string' ? this.#attempts.get(id) : undefined;
      if (
        !attempt ||
        attempt.used ||
        attempt.revoked ||
        params?.['name'] !== attempt.input.tool.remoteToolName ||
        fingerprint(params?.['arguments']) !== fingerprint(attempt.input.arguments)
      )
        throw new McpError(
          'UNREGISTERED_DISPATCH',
          'An unregistered or repeated tool dispatch was blocked',
        );
      attempt.used = true;
      const task = this.dispatch(message, attempt);
      attempt.sends.add(task);
      await task;
      return;
    }
    if (this.#failed || this.#controller.signal.aborted || !this.#process)
      throw new McpError('CONNECTION_CLOSED', 'The local connection is closed');
    await this.#process.write(Buffer.from(serializeMessage(message)), {
      signal: this.#controller.signal,
    });
  }

  private async dispatch(message: JSONRPCMessage, attempt: DispatchAttempt): Promise<void> {
    if (attempt.revoked || attempt.signal.aborted || this.#controller.signal.aborted)
      throw new McpError('CANCELLED', 'The tool dispatch was cancelled');
    try {
      await attempt.input.beforeDispatch();
    } catch (error) {
      attempt.barrierError = error;
      throw new McpError('BARRIER_FAILED', 'The tool dispatch could not be recorded');
    }
    attempt.barrier = true;
    if (
      attempt.revoked ||
      attempt.signal.aborted ||
      this.#controller.signal.aborted ||
      !this.#process
    )
      throw new McpError('CANCELLED', 'The tool dispatch was cancelled before writing');
    await this.#process.write(Buffer.from(serializeMessage(message)), {
      signal: attempt.signal,
      beforeWrite: () => {
        if (attempt.revoked || attempt.signal.aborted || this.#controller.signal.aborted)
          throw new McpError('CANCELLED', 'The tool dispatch was revoked before writing');
        attempt.written = true;
      },
    });
  }

  private receive(chunk: Buffer): void {
    if (this.#failed) return;
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const end = this.#buffer.indexOf(10);
      if (end < 0) break;
      if (end > MAX_FRAME_BYTES) {
        this.fail('FRAME_LIMIT', 'A local protocol frame exceeded its limit');
        return;
      }
      const now = performance.now();
      this.#frameTokens = Math.min(
        2048,
        this.#frameTokens + ((now - this.#frameTime) * 1024) / 1000,
      );
      this.#frameTime = now;
      this.#frameTokens -= 1;
      this.#frameCount += 1;
      if (this.#frameTokens < 0 || this.#frameCount > 65536) {
        this.fail('FRAME_RATE_LIMIT', 'The local protocol message rate exceeded its limit');
        return;
      }
      const frame = this.#buffer.subarray(0, end);
      this.#buffer = this.#buffer.subarray(end + 1);
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(frame);
        const message = deserializeMessage(text);
        this.onmessage?.(message);
      } catch {
        this.fail('INVALID_PROTOCOL', 'The local tool emitted an invalid protocol frame');
        return;
      }
    }
    if (this.#buffer.length > MAX_FRAME_BYTES)
      this.fail('FRAME_LIMIT', 'The local protocol buffer exceeded its limit');
  }

  private fail(code: string, message: string): void {
    if (this.#failed) return;
    this.#failed = true;
    this.onFault();
    this.onerror?.(new McpError(code, message));
    this.close().catch(() => {
      this.onerror?.(
        new McpError(
          'PROCESS_CLEANUP_FAILED',
          'The local tool process could not be fully cleaned up',
        ),
      );
    });
  }

  public close(): Promise<void> {
    if (this.#closed) return this.#closed;
    this.#failed = true;
    this.#controller.abort();
    for (const attempt of this.#attempts.values()) attempt.revoked = true;
    this.onclose?.();
    this.#closed = (async () => {
      if (this.#process) await this.#process.close();
    })();
    return this.#closed;
  }
}
