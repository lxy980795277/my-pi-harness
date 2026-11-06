/** Expected host-access failure; causes remain available to the host. */
export class SandboxError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SandboxError';
  }
}

/** Whether a filesystem operation reported a missing entry. */
export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Reject work before the next host operation when its owner has cancelled. */
export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new SandboxError('CANCELLED', 'The host operation was cancelled');
}
