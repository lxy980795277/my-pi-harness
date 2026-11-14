export interface RenderDiagnostic {
  sessionId: string;
  seq: number;
  liveRevision: number;
  receivedAt: number;
  commitMs: number | null;
  frameMs: number | null;
  scope: 'mounted-timeline';
}

const observations = new Map<string, RenderDiagnostic>();
const listeners = new Set<() => void>();
const MAX_SESSIONS = 8;

const publish = (diagnostic: RenderDiagnostic): void => {
  observations.set(diagnostic.sessionId, diagnostic);
  for (const listener of listeners) listener();
};

/** Marks a validated SSE position on the same monotonic clock used by the Renderer. */
export const markSessionReceived = (
  sessionId: string,
  seq: number,
  liveRevision: number,
  receivedAt: number,
): void => {
  const current = observations.get(sessionId);
  if (
    current !== undefined &&
    (current.seq > seq || (current.seq === seq && current.liveRevision >= liveRevision))
  )
    return;
  if (!observations.has(sessionId) && observations.size >= MAX_SESSIONS) {
    const oldest = observations.keys().next().value;
    if (oldest !== undefined) observations.delete(oldest);
  }
  publish({
    sessionId,
    seq,
    liveRevision,
    receivedAt,
    commitMs: null,
    frameMs: null,
    scope: 'mounted-timeline',
  });
};

/** Records only the corresponding mounted timeline commit, including virtualized visibility limits. */
export const markTimelineCommitted = (
  sessionId: string,
  seq: number,
  liveRevision: number,
  committedAt: number,
): boolean => {
  const current = observations.get(sessionId);
  if (current === undefined || current.seq !== seq || current.liveRevision !== liveRevision)
    return false;
  if (current.commitMs !== null) return current.frameMs === null;
  publish({ ...current, commitMs: Math.max(0, committedAt - current.receivedAt) });
  return true;
};

/** A later position invalidates older frame callbacks; a frame marker is not proof of screen presentation. */
export const markTimelineFrame = (
  sessionId: string,
  seq: number,
  liveRevision: number,
  frameAt: number,
): void => {
  const current = observations.get(sessionId);
  if (
    current === undefined ||
    current.seq !== seq ||
    current.liveRevision !== liveRevision ||
    current.commitMs === null
  )
    return;
  publish({ ...current, frameMs: Math.max(0, frameAt - current.receivedAt) });
};

/** Subscribers receive only ids and local timing observations, never conversation bodies. */
export const subscribeRenderDiagnostics = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

export const readRenderDiagnostic = (sessionId: string): RenderDiagnostic | null => {
  return observations.get(sessionId) ?? null;
};

/** Authorization cleanup removes the bounded, volatile device measurements. */
export const resetRenderDiagnostics = (): void => {
  observations.clear();
  for (const listener of listeners) listener();
};
