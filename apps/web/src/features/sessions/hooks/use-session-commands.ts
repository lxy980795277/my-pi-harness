import type {
  EditInput,
  InputRequest,
  QueuePatchInput,
  SessionPatchInput,
  SessionSnapshot,
  ToolDecisionInput,
} from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { mergeSessionSnapshot } from '@/features/sessions/queries/projection';
import {
  deleteQueuedInput,
  decideTool,
  editMessage,
  patchQueuedInput,
  patchSession,
  resumeQueue,
  stopSession,
  submitInput,
} from '@/features/sessions/services/sessions';
import { useRequestTask } from '@/hooks/use-request-task';

export interface SessionCommands {
  send: (input: InputRequest) => Promise<void>;
  stop: () => Promise<void>;
  edit: (input: EditInput) => Promise<void>;
  patch: (input: SessionPatchInput) => Promise<void>;
  updateQueue: (id: string, input: QueuePatchInput) => Promise<void>;
  deleteQueue: (id: string) => Promise<void>;
  resume: () => Promise<void>;
  decide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
}

/** All command responses enter the same projection cache as HTTP and SSE reads. */
export const useSessionCommands = (sessionId: string): SessionCommands => {
  const queryClient = useQueryClient();
  const task = useRequestTask();
  const execute = useCallback(
    async (operation: (signal: AbortSignal) => Promise<SessionSnapshot>): Promise<void> => {
      try {
        mergeSessionSnapshot(queryClient, await task(operation));
        await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      } catch (failure: unknown) {
        await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        throw failure;
      }
    },
    [queryClient, sessionId, task],
  );

  const send = useCallback(
    async (input: InputRequest): Promise<void> => {
      return execute((signal): Promise<SessionSnapshot> => {
        return submitInput(sessionId, input, signal);
      });
    },
    [execute, sessionId],
  );
  const stop = useCallback(async (): Promise<void> => {
    return execute((signal): Promise<SessionSnapshot> => {
      return stopSession(sessionId, signal);
    });
  }, [execute, sessionId]);
  const edit = useCallback(
    async (input: EditInput): Promise<void> => {
      return execute((signal): Promise<SessionSnapshot> => {
        return editMessage(sessionId, input, signal);
      });
    },
    [execute, sessionId],
  );
  const patch = useCallback(
    async (input: SessionPatchInput): Promise<void> => {
      return execute((signal): Promise<SessionSnapshot> => {
        return patchSession(sessionId, input, signal);
      });
    },
    [execute, sessionId],
  );
  const updateQueue = useCallback(
    async (id: string, input: QueuePatchInput): Promise<void> => {
      return execute((signal): Promise<SessionSnapshot> => {
        return patchQueuedInput(sessionId, id, input, signal);
      });
    },
    [execute, sessionId],
  );
  const deleteQueue = useCallback(
    async (id: string): Promise<void> => {
      return execute((signal): Promise<SessionSnapshot> => {
        return deleteQueuedInput(sessionId, id, signal);
      });
    },
    [execute, sessionId],
  );
  const resume = useCallback(async (): Promise<void> => {
    return execute((signal): Promise<SessionSnapshot> => {
      return resumeQueue(sessionId, signal);
    });
  }, [execute, sessionId]);
  const decide = useCallback(
    async (id: string, decision: ToolDecisionInput['decision']): Promise<void> => {
      return execute((signal): Promise<SessionSnapshot> => {
        return decideTool(sessionId, id, { decision }, signal);
      });
    },
    [execute, sessionId],
  );

  return { send, stop, edit, patch, updateQueue, deleteQueue, resume, decide };
};
