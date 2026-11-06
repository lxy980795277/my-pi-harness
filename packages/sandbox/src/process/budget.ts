/** Token bucket and cumulative byte limit for one output stream. */
export class ByteBudget {
  #tokens: number;
  #time = performance.now();
  #total = 0;
  public constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly maximum: number,
  ) {
    this.#tokens = burst;
  }
  public accept(bytes: number): boolean {
    const now = performance.now();
    this.#tokens = Math.min(this.burst, this.#tokens + ((now - this.#time) * this.rate) / 1000);
    this.#time = now;
    this.#total += bytes;
    this.#tokens -= bytes;
    return this.#tokens >= 0 && this.#total <= this.maximum;
  }
}

/** Hide complete secrets, ring-buffer fragments and a partially emitted secret prefix. */
export function redactProcessDiagnostics(
  stderr: Buffer,
  truncated: boolean,
  secrets: readonly string[],
): string {
  let text = stderr.toString('utf8');
  if (truncated) text = text.slice(Math.max(0, ...secrets.map((secret) => secret.length)));
  for (const secret of secrets) if (secret.length > 0) text = text.split(secret).join('[redacted]');
  for (const secret of secrets)
    for (let size = 1; size < secret.length; size += 1)
      if (text.endsWith(secret.slice(0, size))) text = text.slice(0, -size) + '[redacted]';
  return text;
}
