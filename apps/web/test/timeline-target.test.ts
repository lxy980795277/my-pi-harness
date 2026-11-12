import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../src/features/sessions/stores/timeline';
import type { TimelineEntry } from '../src/features/sessions/types/session';
import { timelineMessageLocation } from '../src/features/sessions/utils/timeline-target';
import { SOURCE_MESSAGE } from './fixtures/search';

beforeEach(() => {
  useTimelineStore.getState().reset();
});

describe('stable virtual source targets', () => {
  it('locates the body inside a collapsed process and never substitutes thinking or equal text from another message', () => {
    const entries: TimelineEntry[] = [
      {
        type: 'message',
        id: 'thinking:source-message',
        createdAt: 1,
        message: SOURCE_MESSAGE,
        part: 'thinking',
      },
      {
        type: 'process',
        id: 'process:input',
        sessionId: SOURCE_MESSAGE.sessionId,
        inputId: 'input',
        durationLabel: '1s',
        entries: [
          {
            type: 'message',
            id: 'message:source-message',
            createdAt: 1,
            message: SOURCE_MESSAGE,
            part: 'body',
          },
        ],
      },
    ];
    expect(timelineMessageLocation(entries, SOURCE_MESSAGE.id)).toEqual({
      index: 1,
      processInputId: 'input',
    });
    expect(timelineMessageLocation(entries, 'same-text-another-id')).toBeNull();
    expect(timelineMessageLocation(entries.slice(0, 1), SOURCE_MESSAGE.id)).toBeNull();
  });

  it('expands processes idempotently and prevents an older completion from clearing a newer navigation target', () => {
    const store = useTimelineStore.getState();
    store.setProcessExpanded('session', 'input', true);
    store.setProcessExpanded('session', 'input', true);
    expect(useTimelineStore.getState().expandedProcesses.session?.input).toBe(true);
    store.locate('session', { id: 'first', branchId: 'branch', messageId: 'first-message' });
    const newer = { id: 'newer', branchId: 'branch', messageId: 'newer-message' };
    store.locate('session', newer);
    store.clearTarget('session', 'first');
    expect(useTimelineStore.getState().targets.session).toEqual(newer);
    store.reset();
    expect(useTimelineStore.getState().targets).toEqual({});
  });
});
