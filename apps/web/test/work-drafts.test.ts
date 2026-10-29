import type { QuestionItem } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { useWorkDraftStore } from '../src/features/work/stores/drafts';

const item: QuestionItem = {
  id: 'choice',
  header: 'Choice',
  prompt: 'Choose a source',
  options: [
    { id: 'a', label: 'A', description: '' },
    { id: 'b', label: 'B', description: '' },
  ],
  multiSelect: false,
  allowCustomInput: true,
};

afterEach(() => {
  useWorkDraftStore.getState().reset();
});

describe('unsubmitted work drafts', () => {
  it('retains answers by original request through remounts without mixing equally named task questions', () => {
    const commands = useWorkDraftStore.getState();
    commands.choose('task-one-question', item, 'a');
    commands.text('task-one-question', item.id, 'Source checked');
    commands.move('task-one-question', 1);
    commands.choose('task-two-question', item, 'b');
    const state = useWorkDraftStore.getState();
    expect(state.questions['task-one-question']).toEqual({
      index: 1,
      answers: { choice: { questionId: 'choice', optionIds: ['a'], text: 'Source checked' } },
    });
    expect(state.questions['task-two-question']?.answers['choice']?.optionIds).toEqual(['b']);
    commands.clearQuestion('task-one-question');
    expect(useWorkDraftStore.getState().questions['task-one-question']).toBeUndefined();
    expect(useWorkDraftStore.getState().questions['task-two-question']).toBeDefined();
  });

  it('keeps plan feedback separate and clears all private unsent text on authorization reset', () => {
    const commands = useWorkDraftStore.getState();
    commands.setFeedback('first-plan', 'Add evidence');
    commands.setFeedback('second-plan', 'Check scope');
    commands.clearFeedback('first-plan');
    expect(useWorkDraftStore.getState().feedback).toEqual({ 'second-plan': 'Check scope' });
    commands.text('question', item.id, 'Unsubmitted answer');
    commands.reset();
    expect(useWorkDraftStore.getState().feedback).toEqual({});
    expect(useWorkDraftStore.getState().questions).toEqual({});
  });
});
