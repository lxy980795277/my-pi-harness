/** Safe remote transport failures contain owned messages, never raw requests or provider causes. */
export class NetworkError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}
