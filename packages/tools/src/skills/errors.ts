/** Failures identify invalid sources without exposing resource content. */
export class SkillError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SkillError';
  }
}
