import { canonicalToolJson } from './identity';

const REMINDER_COUNTS = new Set([3, 5, 8]);

/** One Run's consecutive accepted calls; notices advise the model without changing execution. */
export class RepeatToolReminder {
  private key: string | undefined;
  private count = 0;

  /** Validated JSON arguments identify the full call; notices never quote their contents. */
  public observe(name: string, args: Record<string, unknown>): string | undefined {
    const key = canonicalToolJson([name, args]);
    this.count = key === this.key ? this.count + 1 : 1;
    this.key = key;
    if (!REMINDER_COUNTS.has(this.count)) return undefined;
    return `Host reminder: This tool and its arguments have been used ${this.count} times consecutively. Review the available results before retrying; choose a different approach if the task is not progressing.`;
  }
}
