import type {
  HarnessEvent,
  ResolvedSessionCreateInput,
  SessionSnapshot,
  SessionSummary,
  FrozenSkill,
} from '@my-pi-harness/protocol';

/** One short local transaction; privateData never enters the public event. */
export interface EventInput {
  type: string;
  runId: string | null;
  at: number;
  data: HarnessEvent['data'];
  privateData?: Record<string, unknown>;
}

/** Stored acceptance remains stable after an input is consumed. */
export interface RequestAcceptance {
  runId: string | null;
  inputId: string | null;
}

/** Storage owns sequence allocation, uniqueness, migrations and atomic projections. */
export interface RuntimeStore {
  createSession(
    input: ResolvedSessionCreateInput & { id: string; branchId: string; at: number },
  ): SessionSummary;
  listSessions(): SessionSummary[];
  getSession(id: string): SessionSummary | undefined;
  getSnapshot(id: string): SessionSnapshot;
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
