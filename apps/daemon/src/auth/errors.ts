/** A login failure with a safe public message and an explicit HTTP status. */
export class LoginError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}
