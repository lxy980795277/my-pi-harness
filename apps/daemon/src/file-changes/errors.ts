/** Bounded application diagnostics; operation conflicts do not imply an earlier write was absent. */
export class FileChangeError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'FileChangeError';
  }
}
