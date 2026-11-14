import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import {
  markTimelineCommitted,
  markTimelineFrame,
  readRenderDiagnostic,
  subscribeRenderDiagnostics,
  type RenderDiagnostic,
} from '@/utils/render-diagnostics';

/** Measures the mounted visible-list commit only; unmounted history and screen presentation are outside this observation. */
export const useTimelineRenderMark = (
  sessionId: string,
  seq: number,
  liveRevision: number,
): void => {
  useLayoutEffect(() => {
    if (document.visibilityState !== 'visible') return;
    const observed = markTimelineCommitted(sessionId, seq, liveRevision, performance.now());
    if (!observed) return;
    const frame = requestAnimationFrame((): void => {
      if (document.visibilityState === 'visible')
        markTimelineFrame(sessionId, seq, liveRevision, performance.now());
    });
    return (): void => {
      cancelAnimationFrame(frame);
    };
  }, [liveRevision, seq, sessionId]);
};

/** Reads the latest local device observation without mixing server and browser clocks. */
export const useRenderDiagnostic = (sessionId: string): RenderDiagnostic | null => {
  const read = useCallback(() => {
    return readRenderDiagnostic(sessionId);
  }, [sessionId]);
  return useSyncExternalStore(subscribeRenderDiagnostics, read, read);
};
