import type { HarnessEvent, SessionSnapshot, SessionSummary } from '@my-pi-harness/protocol';
import type {
  EventInput,
  RequestAcceptance,
  SessionCreateRecord,
  FrozenSkill,
  LiveMessageDelta,
} from '@my-pi-harness/protocol/internal';

export type { EventInput, RequestAcceptance } from '@my-pi-harness/protocol/internal';

/** Durable events retain their journal identity; live deltas only announce an updated snapshot. */
export type RuntimeNotification =
  | HarnessEvent
  | { type: 'message.delta'; sessionId: string; runId: string };

/** Storage owns sequence allocation, uniqueness, migrations and atomic projections. */
export interface RuntimeStore {
  createSession(input: SessionCreateRecord): SessionSummary;
  listSessions(): SessionSummary[];
  getSession(id: string): SessionSummary | undefined;
  getSnapshot(id: string): SessionSnapshot;
  publishMessageDelta(sessionId: string, delta: LiveMessageDelta): void;
  append(sessionId: string, events: readonly EventInput[]): HarnessEvent[];
  readEvents(sessionId: string, afterSeq: number, limit: number): HarnessEvent[];
  getModelContext(
    sessionId: string,
    branchId: string,
    messageIds?: readonly string[],
  ): Record<string, unknown>[];
  /** Read frozen instruction provenance only from the selected branch and retained history. */
  getSkillContext?(
    sessionId: string,
    branchId: string,
    messageIds?: readonly string[],
  ): readonly FrozenSkill[];
  /** Read the context reset marker recorded when this summary was first created. */
  getCompactionContextStart?(sessionId: string, compactionId: string): string | null;
  getQueueBranch(sessionId: string, inputId: string): string;
  getQueuePrivateData(sessionId: string, inputId: string): Record<string, unknown> | null;
  findRequest(sessionId: string, requestId: string): RequestAcceptance | undefined;
  recoverInterrupted(): HarnessEvent[];
}

/** The accepted input may belong to an active run or the durable queue. */
export interface InputAcceptance extends RequestAcceptance {
  sessionId: string;
  queued: boolean;
}
