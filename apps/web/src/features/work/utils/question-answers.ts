import type { QuestionItem, QuestionResponse } from '@my-pi-harness/protocol';

/** Keeps option identifiers stable when labels or descriptions contain matching text. */
export const toggleQuestionOption = (
  question: QuestionItem,
  current: QuestionResponse,
  optionId: string,
): QuestionResponse => {
  if (!question.multiSelect) {
    return { ...current, optionIds: [optionId] };
  }
  if (current.optionIds.includes(optionId)) {
    return {
      ...current,
      optionIds: current.optionIds.filter((id) => {
        return id !== optionId;
      }),
    };
  }
  return { ...current, optionIds: [...current.optionIds, optionId] };
};

/** The UI validates each question before it can submit the complete response set. */
export const validQuestionResponse = (
  question: QuestionItem,
  response: QuestionResponse,
): boolean => {
  if (response.questionId !== question.id) {
    return false;
  }
  if (!question.multiSelect && response.optionIds.length > 1) {
    return false;
  }
  if (new Set(response.optionIds).size !== response.optionIds.length) {
    return false;
  }
  if (
    response.optionIds.some((id) => {
      return !question.options.some((option) => {
        return option.id === id;
      });
    })
  ) {
    return false;
  }
  const text = response.text.trim();
  if (text && !question.allowCustomInput) {
    return false;
  }
  return response.optionIds.length > 0 || (question.allowCustomInput && text.length > 0);
};

export const emptyQuestionResponse = (questionId: string): QuestionResponse => {
  return { questionId, optionIds: [], text: '' };
};

/** History resolves saved option IDs against the exact persisted question. */
export const questionAnswerLabel = (
  question: QuestionItem,
  responses: QuestionResponse[] | null,
): string => {
  const answer = responses?.find((response) => {
    return response.questionId === question.id;
  });
  if (!answer) {
    return '未回答';
  }
  const labels = answer.optionIds.map((id) => {
    const option = question.options.find((entry) => {
      return entry.id === id;
    });
    if (option) {
      return option.label;
    }
    return id;
  });
  if (answer.text) {
    labels.push(answer.text);
  }
  return labels.join('；');
};
