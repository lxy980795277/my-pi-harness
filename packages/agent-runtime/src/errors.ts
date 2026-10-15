/** Stable runtime failures; transport owners choose safe HTTP responses. */
export class RuntimeError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RuntimeError';
  }
}

/** Abort waiting work without treating cancellation as successful execution. */
export function abortError(): Error {
  return new DOMException('Operation cancelled', 'AbortError');
}
