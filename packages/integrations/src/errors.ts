/** Safe integration errors never retain raw stderr, SDK payloads or credential-bearing causes. */
export class McpError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpError';
  }
}
