import type { SessionCreateInput, HarnessEvent } from '../sessions/sessions';

/** Session input after the application has resolved its optional defaults. */
export type ResolvedSessionCreateInput = Required<SessionCreateInput>;

/** Session input with identities and timestamp selected once before its creation transaction. */
export interface SessionCreateRecord extends ResolvedSessionCreateInput {
  id: string;
  branchId: string;
  at: number;
}

/** Host commit input; private recovery data is excluded from the public event envelope. */
export interface EventInput {
  type: string;
  runId: string | null;
  at: number;
  data: HarnessEvent['data'];
  privateData?: Record<string, unknown>;
}

/** Accepted request identity remains stable after queue consumption and process restarts. */
export interface RequestAcceptance {
  runId: string | null;
  inputId: string | null;
}
