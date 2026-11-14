import type { Message, UserMessage } from '@earendil-works/pi-ai';
import type { Compaction, ContextSummary, WorkState } from '@my-pi-harness/protocol';
import type { ResolvedModel } from '../models/gateway';
import type { RequestAdmission } from '../runs/request';
import type { RequestObservation } from '../runs/request-observer';

export interface SummaryInput {
  source: readonly Message[];
  previous: ContextSummary | null;
  state: WorkState;
  resolved: ResolvedModel;
  signal: AbortSignal;
  audit(systemPrompt: string, user: UserMessage, modelRequestId?: string): void;
  admission?: RequestAdmission;
  observation?: RequestObservation;
}

export interface SummaryResult {
  structured: ContextSummary;
  strategy: Compaction['strategy'];
}
