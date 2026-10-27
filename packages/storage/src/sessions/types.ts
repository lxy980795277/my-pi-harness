import type { HarnessEvent, ResolvedSessionCreateInput } from '@my-pi-harness/protocol';

/** IDs and timestamp selected once by the application before the creation transaction. */
export interface CreateSessionInput extends ResolvedSessionCreateInput {
  id: string;
  branchId: string;
  at: number;
}

/** Runtime payload with separately stored host-only codec, never copied to public events. */
export interface EventInput {
  type: string;
  runId: string | null;
  at: number;
  data: HarnessEvent['data'];
  privateData?: string;
}

/** An accepted request survives queue consumption, deletion and process restarts. */
export interface RequestAcceptance {
  runId: string | null;
  inputId: string | null;
}
