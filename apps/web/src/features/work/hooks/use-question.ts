import type { QuestionView } from '@/features/work/types/work';
import type { Question, QuestionResponse } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  emptyQuestionResponse,
  toggleQuestionOption,
  validQuestionResponse,
} from '@/features/work/utils/question-answers';

/** Answers stay local until the whole request has a durable response. */
export const useQuestion = (
  question: Question,
  onAnswer: (id: string, value: QuestionResponse[] | null) => Promise<void>,
): QuestionView => {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuestionResponse>>({});
  const current = question.questions[index];
  const action = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, value: QuestionResponse[] | null): Promise<void> => {
        await onAnswer(question.id, value);
      },
      [onAnswer, question.id],
    ),
  );
  const { run } = action;
  const change = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      if (!current) {
        return;
      }
      const text = event.target.value;
      setAnswers((previous) => {
        const response = previous[current.id] ?? emptyQuestionResponse(current.id);
        return { ...previous, [current.id]: { ...response, text } };
      });
    },
    [current],
  );
  const choose = useCallback(
    (value: string): void => {
      if (!current) {
        return;
      }
      setAnswers((previous) => {
        const response = previous[current.id] ?? emptyQuestionResponse(current.id);
        return { ...previous, [current.id]: toggleQuestionOption(current, response, value) };
      });
    },
    [current],
  );
  const previous = useCallback((): void => {
    setIndex((value) => {
      return Math.max(0, value - 1);
    });
  }, []);
  const next = useCallback((): void => {
    setIndex((value) => {
      return Math.min(question.questions.length - 1, value + 1);
    });
  }, [question.questions.length]);
  const responses = question.questions.map((item) => {
    const response = answers[item.id] ?? emptyQuestionResponse(item.id);
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
  const response = current && answers[current.id];
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
