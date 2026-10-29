import { createHash } from 'node:crypto';
import type { AgentMessageTarget } from '@my-pi-harness/protocol';

/** A retried command keeps its identity independently of JSON property order. */
export function agentMessageId(
  sourceRunId: string,
  target: AgentMessageTarget,
  requestId: string,
): string {
  const destination = target.kind === 'run' ? target.runId : target.taskId;
  return createHash('sha256')
    .update(JSON.stringify([sourceRunId, target.kind, destination, requestId]))
    .digest('hex');
}
