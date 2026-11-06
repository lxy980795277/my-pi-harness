/** Plugin metadata, installation and authorization failures carry owned public codes. */
export class PluginError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginError';
  }
}
