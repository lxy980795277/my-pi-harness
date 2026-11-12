export type MemoryErrorCode = 'MEMORY_INVALID' | 'MEMORY_SNAPSHOT_INVALID';

/** Safe domain failures contain neither remembered bodies nor source text. */
export class MemoryError extends Error {
  public constructor(
    public readonly code: MemoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MemoryError';
  }
}
