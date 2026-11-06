import { resolvePythonRuntime } from '../lib/python-runtime';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import {
  resolveProcess,
  startProcess,
  type ManagedProcess,
  type ProcessAccess,
} from '@my-pi-harness/sandbox';
import type { CommandToolHandlers, ToolOwner, WorkspaceToolContext } from '../lib/tool-context';
import type { CommandRunInput } from '../tools/run-command';
import { type ToolInvocation, ToolError } from '../lib/tool-registry';

export interface CommandResourceLease {
  readonly readOnlyDirectories: readonly string[];
  verify(signal: AbortSignal): Promise<void>;
  release(): void | Promise<void>;
}
export interface CommandBinding {
  owner: ToolOwner;
  access: ProcessAccess;
  workspace(signal: AbortSignal): Promise<WorkspaceToolContext>;
  resources(signal: AbortSignal): Promise<CommandResourceLease>;
  retainExecution?(signal: AbortSignal): Promise<() => void>;
}
interface OutputChunk {
  sequence: number;
  stream: 'stdout' | 'stderr';
  text: string;
}
interface CommandJob {
  id: string;
  owner: ToolOwner;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
  controller: AbortController;
  process?: ManagedProcess;
  resource?: CommandResourceLease;
  readOnly: boolean;
  settled: boolean;
  releaseExecution?(): void;
  chunks: OutputChunk[];
  sequence: number;
  retainedBytes: number;
  totalBytes: number;
  truncated: boolean;
  decoders: { stdout: StringDecoder; stderr: StringDecoder };
  code: number | null;
  error: string | null;
  closed: Promise<void>;
  settle(): void;
}
const RETAINED_BYTES = 2_097_152;
const PAGE_CHARACTERS = 24_000;
const MAX_ACTIVE_COMMANDS = 16;
const MAX_RETAINED_COMMANDS = 128;

/** Session-owned jobs survive a successful root Run, never a task stop, revoke or daemon close. */
export class CommandManager {
  private readonly jobs = new Map<string, CommandJob>();
  private closing = false;
  private readonly sessionClosures = new Map<string, Promise<void>>();
  public bind(binding: CommandBinding): CommandToolHandlers {
    return {
      run: (input, invocation) => this.run(binding, input, invocation),
      wait: async (id, timeout, cursor, signal) => {
        const job = this.require(binding.owner, id);
        await this.wait(job, timeout, signal);
        return this.page(job, cursor);
      },
      stop: async (id, signal) => {
        signal.throwIfAborted();
        const job = this.require(binding.owner, id);
        await this.stop(job);
        return this.page(job, 0);
      },
    };
  }
  private require(owner: ToolOwner, id: string): CommandJob {
    const job = this.jobs.get(id);
    if (!job || job.owner.sessionId !== owner.sessionId || job.owner.taskId !== owner.taskId)
      throw new ToolError('COMMAND_NOT_FOUND', '命令不存在或不属于当前任务；重启后不会重放命令。');
    return job;
  }
  private append(job: CommandJob, stream: OutputChunk['stream'], bytes: Buffer): void {
    job.totalBytes += bytes.length;
    this.appendText(job, stream, job.decoders[stream].write(bytes));
  }
  private appendText(job: CommandJob, stream: OutputChunk['stream'], text: string): void {
    for (let offset = 0; offset < text.length; ) {
      let end = Math.min(offset + 4096, text.length);
      if (
        end < text.length &&
        text.charCodeAt(end - 1) >= 0xd800 &&
        text.charCodeAt(end - 1) <= 0xdbff
      )
        end++;
      const fragment = text.slice(offset, end);
      offset = end;
      job.chunks.push({ sequence: ++job.sequence, stream, text: fragment });
      job.retainedBytes += Buffer.byteLength(fragment);
    }
    while (job.retainedBytes > RETAINED_BYTES && job.chunks.length > 1) {
      const chunk = job.chunks.shift();
      if (!chunk) break;
      job.retainedBytes -= Buffer.byteLength(chunk.text);
      job.truncated = true;
    }
  }
  /** A previous Run's live writer cannot be hidden by starting a new execution tree. */
  public assertWriteAvailable(owner: ToolOwner): void {
    const conflict = [...this.jobs.values()].some(
      (job) =>
        job.owner.sessionId === owner.sessionId &&
        job.owner.runId !== owner.runId &&
        !job.readOnly &&
        !job.settled,
    );
    if (conflict)
      throw new ToolError(
        'COMMAND_WRITE_CONFLICT',
        '此会话的其他运行仍有写入命令，请先等待或停止该命令。',
      );
  }
  public assertSuccessfulProducer(owner: ToolOwner, id: string): void {
    const job = this.require(owner, id);
    if (!job.settled || job.status !== 'completed' || job.code !== 0)
      throw new ToolError('ARTIFACT_PRODUCER_INCOMPLETE', '产物命令尚未成功完成。');
  }
  private async run(
    binding: CommandBinding,
    input: CommandRunInput,
    invocation: ToolInvocation,
  ): Promise<unknown> {
    invocation.signal.throwIfAborted();
    if (this.closing || this.sessionClosures.has(binding.owner.sessionId))
      throw new ToolError('COMMAND_CLOSED', '命令服务或会话正在关闭。');
    if (binding.access !== 'read-only') this.assertWriteAvailable(binding.owner);
    if ([...this.jobs.values()].filter((job) => !job.settled).length >= MAX_ACTIVE_COMMANDS)
      throw new ToolError('COMMAND_LIMIT', '同时运行或清理的命令过多，请等待已有命令结束。');
    let settle = (): void => undefined;
    const job: CommandJob = {
      id: randomUUID(),
      owner: { ...binding.owner },
      readOnly: binding.access === 'read-only',
      settled: false,
      status: 'starting',
      controller: new AbortController(),
      chunks: [],
      sequence: 0,
      retainedBytes: 0,
      totalBytes: 0,
      truncated: false,
      decoders: { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') },
      code: null,
      error: null,
      closed: new Promise((resolve) => {
        settle = resolve;
      }),
      settle: () => {
        job.settled = true;
        settle();
      },
    };
    this.jobs.set(job.id, job);
    const starting = AbortSignal.any([invocation.signal, job.controller.signal]);
    try {
      const workspace = await binding.workspace(starting);
      const resource = await binding.resources(starting);
      job.resource = resource;
      await resource.verify(starting);
      const python = workspace.pythonPath
        ? await resolvePythonRuntime(workspace.pythonPath, starting)
        : undefined;
      const launch = await resolveProcess({
        command: '/bin/bash',
        args: ['--noprofile', '--norc', '-c', input.command],
        workspaceRoot: workspace.workspaceRoot,
        profileDirectory: workspace.profileDirectory,
        environment: python ? { MY_PI_HARNESS_PYTHON: python.program } : {},
        scope: binding.access === 'full-access' ? 'full-access' : 'sandboxed',
        access: binding.access,
        readOnlyDirectories: [
          ...resource.readOnlyDirectories,
          ...(python?.readOnlyDirectories ?? []),
        ],
        limits: {
          lifetimeMs: input.lifetimeMs ?? 14_400_000,
          stdoutBytes: 16_777_216,
          stderrBytes: 16_777_216,
        },
      });
      await resource.verify(starting);
      invocation.signal.throwIfAborted();
      if (this.closing || job.controller.signal.aborted)
        throw new ToolError('COMMAND_CLOSED', '命令启动已取消。');
      const releaseExecution = await binding.retainExecution?.(starting);
      if (releaseExecution) job.releaseExecution = releaseExecution;
      starting.throwIfAborted();
      job.process = await startProcess(
        launch,
        {
          stdout: (b) => this.append(job, 'stdout', b),
          stderr: (b) => this.append(job, 'stderr', b),
          stdoutEnd: () => this.appendText(job, 'stdout', job.decoders.stdout.end()),
          stderrEnd: () => this.appendText(job, 'stderr', job.decoders.stderr.end()),
          fault: (error) => {
            if (job.status !== 'stopped') {
              job.error ??= error.message;
              if (error.code === 'OUTPUT_LIMIT') job.truncated = true;
              job.status = 'failed';
            }
          },
          exit: (result) => {
            job.code = result.code;
          },
        },
        job.controller.signal,
      );
      if (job.status === 'starting') job.status = 'running';
      this.observe(job, job.process);
    } catch (error) {
      if (job.status !== 'stopped') job.status = 'failed';
      job.error = error instanceof Error ? error.message : '命令启动失败。';
      try {
        await job.process?.close();
      } finally {
        await this.releaseJob(job);
      }
      throw error;
    }
    await this.wait(job, input.yieldTimeMs ?? 10_000, invocation.signal);
    return this.page(job, 0);
  }
  private observe(job: CommandJob, process: ManagedProcess): void {
    let verifying: Promise<void> | undefined;
    const verify = async (): Promise<void> => {
      try {
        await job.resource?.verify(job.controller.signal);
      } catch (error) {
        if (job.status !== 'running') return;
        job.error = error instanceof Error ? error.message : '命令资源授权已撤销。';
        job.status = 'failed';
        job.controller.abort(error);
      }
    };
    const verification = setInterval(() => {
      if (verifying || job.status !== 'running') return;
      verifying = verify().finally(() => {
        verifying = undefined;
      });
    }, 1000);
    verification.unref();
    const completion = async (): Promise<void> => {
      try {
        await process.closed;
      } catch (error) {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : '命令清理失败。';
      } finally {
        clearInterval(verification);
        await verifying;
        await this.releaseJob(job);
      }
    };
    completion().catch(() => undefined);
  }
  private async releaseJob(job: CommandJob): Promise<void> {
    try {
      await job.resource?.release();
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : '资源清理失败。';
    } finally {
      delete job.resource;
    }
    try {
      job.releaseExecution?.();
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : '写入租约清理失败。';
    } finally {
      delete job.releaseExecution;
    }
    if (job.status === 'running') job.status = job.code === 0 ? 'completed' : 'failed';
    job.settle();
    this.jobs.delete(job.id);
    this.jobs.set(job.id, job);
    const completed = [...this.jobs.values()].filter((current) => current.settled);
    for (const expired of completed.slice(0, Math.max(0, completed.length - MAX_RETAINED_COMMANDS)))
      this.jobs.delete(expired.id);
  }
  private async wait(job: CommandJob, timeout: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (timeout === 0) return;
    let timer: NodeJS.Timeout | undefined;
    let abort = (): void => undefined;
    try {
      await Promise.race([
        job.closed,
        new Promise<void>((resolve, reject) => {
          timer = setTimeout(resolve, timeout);
          abort = () =>
            reject(new ToolError('CANCELLED', '等待命令已取消。', { cause: signal.reason }));
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  private page(job: CommandJob, cursor: number): unknown {
    let characters = 0;
    let nextCursor = cursor;
    const output: OutputChunk[] = [];
    for (const chunk of job.chunks) {
      if (chunk.sequence <= cursor) continue;
      if (characters + chunk.text.length > PAGE_CHARACTERS && output.length > 0) break;
      output.push(chunk);
      characters += chunk.text.length;
      nextCursor = chunk.sequence;
    }
    return {
      commandId: job.id,
      status: job.status,
      exitCode: job.code,
      error: job.error,
      output,
      nextCursor,
      hasMore: nextCursor < job.sequence,
      totalBytes: job.totalBytes,
      truncated: job.truncated || cursor < (job.chunks[0]?.sequence ?? 1) - 1,
    };
  }
  private async stop(job: CommandJob): Promise<void> {
    if (job.status === 'starting' || job.status === 'running') {
      job.status = 'stopped';
      job.controller.abort(new ToolError('COMMAND_STOPPED', '命令已停止。'));
    }
    let failure: unknown;
    try {
      await job.process?.close();
    } catch (error) {
      failure = error;
    }
    await job.closed;
    if (failure !== undefined)
      throw failure instanceof Error
        ? failure
        : new ToolError('COMMAND_CLEANUP_FAILED', '命令清理失败。', { cause: failure });
  }
  private async drain(jobs: readonly CommandJob[]): Promise<void> {
    const settled = await Promise.allSettled(jobs.map((job) => this.stop(job)));
    const failures: unknown[] = [];
    for (const result of settled) if (result.status === 'rejected') failures.push(result.reason);
    if (failures.length) throw new AggregateError(failures, '命令进程清理失败。');
  }
  public async closeRun(owner: Pick<ToolOwner, 'sessionId' | 'runId'>): Promise<void> {
    await this.drain(
      [...this.jobs.values()].filter(
        (j) => j.owner.sessionId === owner.sessionId && j.owner.runId === owner.runId,
      ),
    );
  }
  public async closeTask(sessionId: string, taskId: string): Promise<void> {
    await this.drain(
      [...this.jobs.values()].filter(
        (j) => j.owner.sessionId === sessionId && j.owner.taskId === taskId,
      ),
    );
  }
  public closeSession(sessionId: string): Promise<void> {
    const previous = this.sessionClosures.get(sessionId);
    if (previous) return previous;
    const close = async (): Promise<void> => {
      try {
        await this.drain(
          [...this.jobs.values()].filter((job) => job.owner.sessionId === sessionId),
        );
        for (const [id, job] of this.jobs)
          if (job.owner.sessionId === sessionId) this.jobs.delete(id);
      } finally {
        this.sessionClosures.delete(sessionId);
      }
    };
    const closing = close();
    this.sessionClosures.set(sessionId, closing);
    return closing;
  }
  public async close(): Promise<void> {
    this.closing = true;
    await this.drain([...this.jobs.values()]);
    this.jobs.clear();
  }
}
