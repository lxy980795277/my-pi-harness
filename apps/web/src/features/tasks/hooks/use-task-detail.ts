import type {
  AgentTaskSummary,
  QuestionResponse,
  ToolDecisionInput,
} from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import type { TaskDetailState } from '@/features/tasks/types/tasks';
import {
  answerAgentQuestion,
  commandAgentWork,
  fetchAgentDetail,
  sendAgentMessage,
  stopAgentTask,
} from '@/features/tasks/services/agents';
import { retainTaskDetail, taskCanStop } from '@/features/tasks/utils/task-view';
import { decideTool } from '@/features/sessions/services/sessions';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { useRequestTask } from '@/hooks/use-request-task';
import { taskMessageKey, useTaskMessageStore } from '@/features/tasks/stores/messages';
import { isRejectedInput } from '@/utils/input-outcome';

/** Commands and pagination belong to the selected task; switching cancels old requests. */
export const useTaskDetail = (task: AgentTaskSummary): TaskDetailState => {
  const client = useQueryClient();
  const request = useRequestTask();
  const [cursor, setCursor] = useState(0);
  const draftKey = taskMessageKey(task.sessionId, task.id);
  const text = useTaskMessageStore((state) => {
    return state.drafts[draftKey] ?? '';
  });
  const attempt = useTaskMessageStore((state) => {
    return state.attempts[draftKey];
  });
  const setDraft = useTaskMessageStore((state) => {
    return state.setDraft;
  });
  const prepare = useTaskMessageStore((state) => {
    return state.prepare;
  });
  const confirm = useTaskMessageStore((state) => {
    return state.confirm;
  });
  const reject = useTaskMessageStore((state) => {
    return state.reject;
  });
  const query = useQuery({
    queryKey: ['agent-detail', task.sessionId, task.id, cursor],
    queryFn: ({ signal }) => {
      return fetchAgentDetail(task.sessionId, task.id, cursor, signal);
    },
    refetchInterval: task.status === 'running' && task.waiting === null && 500,
    structuralSharing: retainTaskDetail,
  });
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['agent-detail', task.sessionId, task.id] }),
      client.invalidateQueries({ queryKey: ['agent-tasks', task.sessionId] }),
      client.invalidateQueries({ queryKey: ['agent-board'] }),
    ]);
  }, [client, task.id, task.sessionId]);
  const stopping = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await stopAgentTask(task, signal);
        signal.throwIfAborted();
        await refresh();
      },
      [refresh, task],
    ),
  );
  const sending = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const input = prepare(draftKey, {
          requestId: crypto.randomUUID(),
          text: text.trim(),
          continue: task.status === 'completed',
          expectedRunId: task.latestRunId,
        });
        try {
          await sendAgentMessage(task.sessionId, task.id, input, signal);
        } catch (failure: unknown) {
          if (!signal.aborted && isRejectedInput(failure)) reject(draftKey, input.requestId);
          throw failure;
        }
        signal.throwIfAborted();
        confirm(draftKey, input.requestId);
        await refresh();
      },
      [
        confirm,
        draftKey,
        prepare,
        refresh,
        reject,
        task.id,
        task.latestRunId,
        task.sessionId,
        task.status,
        text,
      ],
    ),
  );
  const answer = useCallback(
    async (questionId: string, answers: QuestionResponse[] | null): Promise<void> => {
      await request((signal) => {
        return answerAgentQuestion(task.sessionId, task.id, questionId, answers, signal);
      });
      await refresh();
    },
    [refresh, request, task.id, task.sessionId],
  );
  const command = useCallback(
    async (name: string, input: unknown): Promise<void> => {
      await request((signal) => {
        return commandAgentWork(task.sessionId, task.id, name, input, signal);
      });
      await refresh();
    },
    [refresh, request, task.id, task.sessionId],
  );
  const decide = useCallback(
    async (toolCallId: string, decision: ToolDecisionInput['decision']): Promise<void> => {
      await request((signal) => {
        return decideTool(task.sessionId, toolCallId, { decision }, signal);
      });
      await refresh();
    },
    [refresh, request, task.sessionId],
  );
  const changeText = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      setDraft(draftKey, event.target.value);
    },
    [draftKey, setDraft],
  );
  const { run: send } = sending;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (text.trim().length > 0) send();
    },
    [send, text],
  );
  const previous = useCallback((): void => {
    setCursor((current) => {
      return Math.max(0, current - 100);
    });
  }, []);
  const next = useCallback((): void => {
    if (query.data?.nextCursor !== null && query.data?.nextCursor !== undefined)
      setCursor(query.data.nextCursor);
  }, [query.data?.nextCursor]);
  const pendingQuestions =
    query.data?.work.questions.filter((question) => {
      return question.status === 'pending';
    }) ?? [];
  const pendingTools =
    query.data?.tools.filter((tool) => {
      return tool.status === 'awaiting_approval' || tool.status === 'reviewing';
    }) ?? [];
  let modelLabel = '继承父执行模型';
  if (task.role.modelId !== null) modelLabel = task.role.modelId;
  const actualModel = query.data?.runs.at(-1)?.modelId;
  if (actualModel !== undefined) modelLabel = actualModel;
  return {
    query,
    cursor,
    previous,
    next,
    text,
    changeText,
    submit,
    sending,
    stopping,
    answer,
    command,
    decide,
    pendingQuestions,
    pendingTools,
    modelLabel,
    canStop: taskCanStop(task),
    canMessage:
      attempt !== undefined ||
      (task.closedAt === null &&
        (task.status === 'running' || task.status === 'waiting' || task.status === 'completed')),
    uncertain: attempt !== undefined && !sending.pending,
    draftLocked: attempt !== undefined || sending.pending,
    continuing: attempt?.continue ?? task.status === 'completed',
  };
};
