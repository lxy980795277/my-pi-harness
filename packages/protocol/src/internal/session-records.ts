import { Type, type Static } from 'typebox';
import { SessionCreateInputSchema, type HarnessEvent } from '../sessions/sessions';

export type ResolvedSessionCreateInput = Static<typeof ResolvedSessionCreateInputSchema>;

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

/** Resolved owner selection contains all defaults required for durable session creation. */
export const ResolvedSessionCreateInputSchema = Type.Required(SessionCreateInputSchema);
