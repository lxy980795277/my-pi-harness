import type { QuestionView } from '@/features/work/types/work';
import type { Question, QuestionResponse } from '@my-pi-harness/protocol';
import { useCallback, type ChangeEvent, type SubmitEvent } from 'react';
import { useWorkDraftStore } from '@/features/work/stores/drafts';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  emptyQuestionResponse,
  validQuestionResponse,
} from '@/features/work/utils/question-answers';

/** Unsubmitted answers stay in a request-keyed client draft until a durable response is accepted. */
export const useQuestion = (
  question: Question,
  onAnswer: (id: string, value: QuestionResponse[] | null) => Promise<void>,
): QuestionView => {
  const draft = useWorkDraftStore((state) => {
    return state.questions[question.id];
  });
  const setText = useWorkDraftStore((state) => {
    return state.text;
  });
  const chooseOption = useWorkDraftStore((state) => {
    return state.choose;
  });
  const move = useWorkDraftStore((state) => {
    return state.move;
  });
  const clear = useWorkDraftStore((state) => {
    return state.clearQuestion;
  });
  const index = draft?.index ?? 0;
  const answers = draft?.answers;
  const current = question.questions[index];
  const action = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, value: QuestionResponse[] | null): Promise<void> => {
        await onAnswer(question.id, value);
        clear(question.id);
      },
      [clear, onAnswer, question.id],
    ),
  );
  const { run } = action;
  const change = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      if (!current) {
        return;
      }
      setText(question.id, current.id, event.target.value);
    },
    [current, question.id, setText],
  );
  const choose = useCallback(
    (value: string): void => {
      if (!current) {
        return;
      }
      chooseOption(question.id, current, value);
    },
    [chooseOption, current, question.id],
  );
  const previous = useCallback((): void => {
    move(question.id, Math.max(0, index - 1));
  }, [index, move, question.id]);
  const next = useCallback((): void => {
    move(question.id, Math.min(question.questions.length - 1, index + 1));
  }, [index, move, question.id, question.questions.length]);
  const responses = question.questions.map((item) => {
    const response = answers?.[item.id] ?? emptyQuestionResponse(item.id);
    return { ...response, text: response.text.trim() };
  });
  const valid = question.questions.every((item, position) => {
    const response = responses[position];
    return response !== undefined && validQuestionResponse(item, response);
  });
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (valid) {
        run(responses);
      }
    },
    [responses, run, valid],
  );
  const cancel = useCallback((): void => {
    run(null);
  }, [run]);
  const response = current && answers?.[current.id];
  let currentValid = false;
  if (current && response) {
    currentValid = validQuestionResponse(current, response);
  }
  return {
    current,
    index,
    selected: response?.optionIds ?? [],
    text: response?.text ?? '',
    change,
    choose,
    previous,
    next,
    submit,
    cancel,
    valid,
    currentValid,
    last: index === question.questions.length - 1,
    action,
  };
};
