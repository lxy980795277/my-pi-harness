/** Expected, safe-to-display tool failure; cause is retained only for the host. */
export class ExecutionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExecutionError';
  }
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ExecutionError('CANCELLED', 'Tool execution was cancelled');
}
