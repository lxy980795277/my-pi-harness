import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../src/features/sessions/stores/timeline';

beforeEach(() => {
  useTimelineStore.getState().reset();
});

describe('volatile timeline disclosure choices', () => {
  it('retains choices after the last subscriber leaves and a later subscriber returns', () => {
    const updates: boolean[] = [];
    const unsubscribe = useTimelineStore.subscribe((state) => {
      updates.push(state.expandedTools['session-a']?.['tool-a'] === true);
    });
    useTimelineStore.getState().toggleTool('session-a', 'tool-a');
    unsubscribe();
    useTimelineStore.getState().toggleTool('session-a', 'tool-b');

    expect(updates).toEqual([true]);
    expect(useTimelineStore.getState().expandedTools['session-a']).toEqual({
      'tool-a': true,
      'tool-b': true,
    });

    const returnedUpdates: boolean[] = [];
    const returnedUnsubscribe = useTimelineStore.subscribe((state) => {
      returnedUpdates.push(state.expandedTools['session-a']?.['tool-a'] === true);
    });
    try {
      useTimelineStore.getState().toggleTool('session-a', 'tool-a');
      expect(returnedUpdates).toEqual([false]);
      expect(useTimelineStore.getState().expandedTools['session-a']?.['tool-b']).toBe(true);
    } finally {
      returnedUnsubscribe();
    }
  });

  it('isolates sessions even when their tool ids match and preserves other session references', () => {
    const state = useTimelineStore.getState();
    state.setToolExpanded('session-a', 'tool', true);
    const sessionA = useTimelineStore.getState().expandedTools['session-a'];
    state.setToolExpanded('session-b', 'tool', false);
    state.toggleTool('session-b', 'other-tool');
    expect(useTimelineStore.getState().expandedTools['session-a']).toBe(sessionA);
    expect(useTimelineStore.getState().expandedTools['session-a']?.['tool']).toBe(true);
    expect(useTimelineStore.getState().expandedTools['session-b']).toEqual({
      tool: false,
      'other-tool': true,
    });
  });

  it('starts processes closed and retains input choices after all subscribers leave', () => {
    expect(useTimelineStore.getState().expandedProcesses).toEqual({});
    const updates: boolean[] = [];
    const unsubscribe = useTimelineStore.subscribe((state) => {
      updates.push(state.expandedProcesses['session-a']?.['input-a'] === true);
    });
    useTimelineStore.getState().toggleProcess('session-a', 'input-a');
    unsubscribe();
    useTimelineStore.getState().toggleProcess('session-a', 'input-b');
    expect(updates).toEqual([true]);
    expect(useTimelineStore.getState().expandedProcesses['session-a']).toEqual({
      'input-a': true,
      'input-b': true,
    });
    const returnedUpdates: boolean[] = [];
    const returnedUnsubscribe = useTimelineStore.subscribe((state) => {
      returnedUpdates.push(state.expandedProcesses['session-a']?.['input-a'] === true);
    });
    try {
      useTimelineStore.getState().toggleProcess('session-a', 'input-a');
      expect(returnedUpdates).toEqual([false]);
      expect(useTimelineStore.getState().expandedProcesses['session-a']?.['input-b']).toBe(true);
    } finally {
      returnedUnsubscribe();
    }
  });

  it('isolates process inputs and sessions without changing nested tool disclosure choices', () => {
    const state = useTimelineStore.getState();
    state.setToolExpanded('session-a', 'tool', true);
    state.toggleProcess('session-a', 'input');
    const tools = useTimelineStore.getState().expandedTools;
    const sessionA = useTimelineStore.getState().expandedProcesses['session-a'];
    state.toggleProcess('session-b', 'input');
    expect(useTimelineStore.getState().expandedProcesses['session-a']).toBe(sessionA);
    state.toggleProcess('session-a', 'other-input');
    state.toggleProcess('session-a', 'input');
    expect(useTimelineStore.getState().expandedProcesses).toEqual({
      'session-a': { input: false, 'other-input': true },
      'session-b': { input: true },
    });
    expect(useTimelineStore.getState().expandedTools).toBe(tools);
    state.toggleProcess('session-a', 'input');
    expect(useTimelineStore.getState().expandedTools['session-a']?.['tool']).toBe(true);
  });

  it('clears all private disclosure choices when the application resets', () => {
    const state = useTimelineStore.getState();
    state.setToolExpanded('session-a', 'approved', true);
    state.setToolExpanded('session-b', 'denied', true);
    state.toggleProcess('session-a', 'input');
    state.toggleProcess('session-b', 'input');
    state.reset();
    expect(useTimelineStore.getState().expandedTools).toEqual({});
    expect(useTimelineStore.getState().expandedProcesses).toEqual({});
    state.toggleTool('session-a', 'approved');
    expect(useTimelineStore.getState().expandedTools['session-a']?.['approved']).toBe(true);
    expect(useTimelineStore.getState().expandedTools['session-b']).toBeUndefined();
  });
});
