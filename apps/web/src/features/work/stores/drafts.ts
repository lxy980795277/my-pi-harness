import type { QuestionItem, QuestionResponse } from '@my-pi-harness/protocol';
import { create } from 'zustand';
import {
  emptyQuestionResponse,
  toggleQuestionOption,
} from '@/features/work/utils/question-answers';

interface QuestionDraft {
  index: number;
  answers: Record<string, QuestionResponse>;
}
interface WorkDraftState {
  questions: Record<string, QuestionDraft>;
  feedback: Record<string, string>;
  text: (requestId: string, questionId: string, value: string) => void;
  choose: (requestId: string, question: QuestionItem, optionId: string) => void;
  move: (requestId: string, index: number) => void;
  clearQuestion: (requestId: string) => void;
  setFeedback: (planId: string, value: string) => void;
  clearFeedback: (planId: string) => void;
  reset: () => void;
}

const EMPTY_DRAFT: QuestionDraft = { index: 0, answers: {} };

/** Unsubmitted answers survive task panel closure in memory and are cleared on logout or submission. */
export const useWorkDraftStore = create<WorkDraftState>((set) => {
  return {
    questions: {},
    feedback: {},
    text: (requestId, questionId, text): void => {
      set((state) => {
        const draft = state.questions[requestId] ?? EMPTY_DRAFT;
        const response = draft.answers[questionId] ?? emptyQuestionResponse(questionId);
        return {
          questions: {
            ...state.questions,
            [requestId]: {
              ...draft,
              answers: { ...draft.answers, [questionId]: { ...response, text } },
            },
          },
        };
      });
    },
    choose: (requestId, question, optionId): void => {
      set((state) => {
        const draft = state.questions[requestId] ?? EMPTY_DRAFT;
        const response = draft.answers[question.id] ?? emptyQuestionResponse(question.id);
        return {
          questions: {
            ...state.questions,
            [requestId]: {
              ...draft,
              answers: {
                ...draft.answers,
                [question.id]: toggleQuestionOption(question, response, optionId),
              },
            },
          },
        };
      });
    },
    move: (requestId, index): void => {
      set((state) => {
        const draft = state.questions[requestId] ?? EMPTY_DRAFT;
        return { questions: { ...state.questions, [requestId]: { ...draft, index } } };
      });
    },
    clearQuestion: (requestId): void => {
      set((state) => {
        const questions = { ...state.questions };
        delete questions[requestId];
        return { questions };
      });
    },
    setFeedback: (planId, value): void => {
      set((state) => {
        return { feedback: { ...state.feedback, [planId]: value } };
      });
    },
    clearFeedback: (planId): void => {
      set((state) => {
        const feedback = { ...state.feedback };
        delete feedback[planId];
        return { feedback };
      });
    },
    reset: (): void => {
      set({ questions: {}, feedback: {} });
    },
  };
});
