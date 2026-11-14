import { beforeEach, describe, expect, it } from 'vitest';
import {
  markSessionReceived,
  markTimelineCommitted,
  markTimelineFrame,
  readRenderDiagnostic,
  resetRenderDiagnostics,
  subscribeRenderDiagnostics,
} from '../src/utils/render-diagnostics';

beforeEach(resetRenderDiagnostics);

describe('local timeline render observations', () => {
  it('uses one client clock and distinguishes commit from a later frame marker', () => {
    markSessionReceived('session', 10, 2, 100);
    expect(markTimelineCommitted('session', 10, 2, 118)).toBe(true);
    expect(readRenderDiagnostic('session')).toMatchObject({
      commitMs: 18,
      frameMs: null,
      scope: 'mounted-timeline',
    });
    markTimelineFrame('session', 10, 2, 132);
    expect(readRenderDiagnostic('session')).toMatchObject({ commitMs: 18, frameMs: 32 });
    expect(markTimelineCommitted('session', 10, 2, 140)).toBe(false);
  });

  it('ignores stale positions and late callbacks from an older revision', () => {
    markSessionReceived('session', 10, 2, 100);
    markTimelineCommitted('session', 10, 2, 118);
    markSessionReceived('session', 10, 3, 150);
    markSessionReceived('session', 9, 100, 170);
    markTimelineFrame('session', 10, 2, 180);
    expect(markTimelineCommitted('session', 10, 2, 190)).toBe(false);
    expect(readRenderDiagnostic('session')).toMatchObject({
      seq: 10,
      liveRevision: 3,
      receivedAt: 150,
      commitMs: null,
      frameMs: null,
    });
    markTimelineFrame('session', 10, 3, 200);
    expect(readRenderDiagnostic('session')?.frameMs).toBeNull();
  });

  it('allows a StrictMode re-setup to schedule the unobserved frame without replacing the first commit', () => {
    markSessionReceived('session', 10, 2, 100);
    expect(markTimelineCommitted('session', 10, 2, 110)).toBe(true);
    expect(markTimelineCommitted('session', 10, 2, 115)).toBe(true);
    markTimelineFrame('session', 10, 2, 130);
    expect(readRenderDiagnostic('session')).toMatchObject({ commitMs: 10, frameMs: 30 });
  });

  it('bounds retained session ids, unsubscribes listeners, and clears on authorization loss', () => {
    let updates = 0;
    const close = subscribeRenderDiagnostics(() => {
      updates += 1;
    });
    for (let index = 0; index < 12; index += 1)
      markSessionReceived('session-' + String(index), 1, 0, 100);
    expect(readRenderDiagnostic('session-0')).toBeNull();
    expect(readRenderDiagnostic('session-11')).not.toBeNull();
    expect(updates).toBe(12);
    close();
    resetRenderDiagnostics();
    expect(updates).toBe(12);
    expect(readRenderDiagnostic('session-11')).toBeNull();
  });
});
