import type { SandboxError } from '../errors';

/** UI scope; sandboxed resolves to workspace-write unless explicitly narrowed. */
export type ProcessScope = 'sandboxed' | 'full-access';
export type ProcessAccess = 'read-only' | 'workspace-write' | 'full-access';

/** Byte and lifetime budgets belong to the process rather than a caller's wait. */
export interface ProcessLimits {
  stdoutBytes?: number;
  stdoutBytesPerSecond?: number;
  stdoutBurstBytes?: number;
  stderrBytes?: number;
  stderrBytesPerSecond?: number;
  stderrBurstBytes?: number;
  diagnosticBytes?: number;
  queuedWriteBytes?: number;
  lifetimeMs?: number;
  terminateGraceMs?: number;
  killWaitMs?: number;
  pipeCloseMs?: number;
}

/** Host-authorized program, workspace and precise extra read directories. */
export interface ProcessInput {
  command: string;
  args: readonly string[];
  workspaceRoot: string;
  profileDirectory: string;
  environment: Readonly<Record<string, string>>;
  scope: ProcessScope;
  access?: ProcessAccess;
  readOnlyDirectories?: readonly string[];
  limits?: ProcessLimits;
}

export interface FileIdentity {
  device: number;
  inode: number;
  size: number;
  modifiedMs: number;
}

export interface ProcessLaunch extends ProcessInput {
  access: ProcessAccess;
  readOnlyDirectories: readonly string[];
  resourceIdentities: readonly { path: string; device: number; inode: number }[];
  argumentIdentities: readonly ({ path: string } & FileIdentity)[];
  resolvedCommand: string;
  programIdentity: FileIdentity;
  workspaceIdentity: { device: number; inode: number };
  limits: Required<Omit<ProcessLimits, 'lifetimeMs'>> & { lifetimeMs?: number };
}

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** Callbacks consume bytes; protocol parsing and message ownership remain with the caller. */
export interface ProcessObserver {
  stdout(chunk: Buffer): void;
  stdoutEnd(): void;
  fault(error: SandboxError): void;
  stderr?(chunk: Buffer): void;
  stderrEnd?(): void;
  exit?(result: ProcessExit): void;
}

/** Process-group owner with bounded queued writes and awaitable physical cleanup. */
export interface ManagedProcess {
  readonly closed: Promise<void>;
  readonly exit: Promise<ProcessExit>;
  /** Cancellation is rechecked after queuing and immediately before stdin.write. */
  write(
    bytes: Uint8Array,
    options: { signal: AbortSignal; beforeWrite?: () => void },
  ): Promise<void>;
  diagnostics(): string;
  /** Rejects new writes synchronously and waits for process group, pipes and temporary files. */
  close(): Promise<void>;
}
