import { RuntimeError } from '@my-pi-harness/agent-runtime';

/** Every owned resource settles before shutdown reports failures; closing work may reject new operations. */
export async function closeMcpResources(tasks: readonly Promise<unknown>[]): Promise<void> {
  const settled = await Promise.allSettled(tasks);
  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result): unknown => result.reason)
    .filter((error) => !(error instanceof RuntimeError && error.code === 'MCP_CLOSED'));
  if (failures.length > 0) throw new AggregateError(failures, 'MCP shutdown failed');
}
