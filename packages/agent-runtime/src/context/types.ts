import type { Message, UserMessage } from '@earendil-works/pi-ai';
import type { Compaction, ContextSummary, WorkState } from '@my-pi-harness/protocol';
import type { ResolvedModel } from '../models/gateway.js';

export interface SummaryInput {
  source: readonly Message[];
  previous: ContextSummary | null;
  state: WorkState;
  resolved: ResolvedModel;
  signal: AbortSignal;
  audit(systemPrompt: string, user: UserMessage): void;
}

export interface SummaryResult {
  structured: ContextSummary;
  strategy: Compaction['strategy'];
}
