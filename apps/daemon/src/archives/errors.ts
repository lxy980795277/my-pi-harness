/** Archive failures never expose temporary paths or untrusted parser diagnostics to clients. */
export class ArchiveError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ArchiveError';
  }
}
