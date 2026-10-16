import type { QuestionItem } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import {
  emptyQuestionResponse,
  questionAnswerLabel,
  toggleQuestionOption,
  validQuestionResponse,
} from '../src/features/work/utils/question-answers';
const item: QuestionItem = {
  id: 'language',
  header: '语言',
  prompt: '选择语言',
  options: [
    { id: 'ts', label: 'TypeScript', description: '严格类型' },
    { id: 'js', label: 'JavaScript', description: '' },
  ],
  multiSelect: false,
  allowCustomInput: false,
};
describe('structured question answers', () => {
  it('uses option IDs, replaces single selections and toggles multiple selections', () => {
    const first = toggleQuestionOption(item, emptyQuestionResponse(item.id), 'ts');
    expect(toggleQuestionOption(item, first, 'js').optionIds).toEqual(['js']);
    const multi = { ...item, multiSelect: true };
    const both = toggleQuestionOption(multi, first, 'js');
    expect(both.optionIds).toEqual(['ts', 'js']);
    expect(toggleQuestionOption(multi, both, 'ts').optionIds).toEqual(['js']);
    expect(questionAnswerLabel(item, [first])).toBe('TypeScript');
  });
  it('requires an answer for the right question and enforces declared custom and selection modes', () => {
    const empty = emptyQuestionResponse(item.id);
    expect(validQuestionResponse(item, empty)).toBe(false);
    expect(validQuestionResponse(item, { ...empty, optionIds: ['ts'] })).toBe(true);
    expect(validQuestionResponse(item, { ...empty, optionIds: ['unknown'] })).toBe(false);
    expect(validQuestionResponse(item, { ...empty, optionIds: ['ts', 'js'] })).toBe(false);
    expect(
      validQuestionResponse({ ...item, multiSelect: true }, { ...empty, optionIds: ['ts', 'ts'] }),
    ).toBe(false);
    expect(validQuestionResponse(item, { ...empty, questionId: 'other', optionIds: ['ts'] })).toBe(
      false,
    );
    expect(validQuestionResponse(item, { ...empty, text: 'Rust' })).toBe(false);
    expect(
      validQuestionResponse({ ...item, allowCustomInput: true }, { ...empty, text: '  Rust  ' }),
    ).toBe(true);
    expect(questionAnswerLabel(item, null)).toBe('未回答');
  });
});
