import type { QuestionView } from '@/features/work/types/work-view';
import type { Question } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** An answer stays in the local form until the durable response is acknowledged. */
export const useQuestion = (
  question: Question,
  onAnswer: (id: string, value: string | null) => Promise<void>,
): QuestionView => {
  const [answer, setAnswer] = useState('');
  const action = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, value: string | null): Promise<void> => {
        await onAnswer(question.id, value);
      },
      [onAnswer, question.id],
    ),
  );
  const { run } = action;
  const change = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setAnswer(event.target.value);
  }, []);
  const choose = useCallback((value: string): void => {
    setAnswer(value);
  }, []);
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (answer.trim()) {
        run(answer.trim());
      }
    },
    [answer, run],
  );
  const cancel = useCallback((): void => {
    run(null);
  }, [run]);
  return { answer, change, choose, submit, cancel, action };
};
