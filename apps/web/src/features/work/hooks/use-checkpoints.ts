import type { CheckpointAction, CheckpointView, ComparisonState } from '@/features/work/types/work';
import type { SessionSnapshot, WorkSnapshot } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { checkpointOptions, compareWork } from '@/features/work/utils/work-view';

/** Restore and reset remain explicit, revision-checked commands with no side-effect replay. */
export const useCheckpoints = (
  work: WorkSnapshot,
  session: SessionSnapshot,
  onCommand: (command: string, input: unknown) => Promise<void>,
): CheckpointView => {
  const [label, setLabel] = useState('');
  const [leftId, setLeftId] = useState('current');
  const [rightId, setRightId] = useState('current');
  const [confirmation, setConfirmation] = useState<CheckpointAction | null>(null);
  const action = useAsyncEvent(
    useCallback(
      async (_signal: AbortSignal, name: string, input: unknown): Promise<void> => {
        await onCommand(name, input);
        setConfirmation(null);
        setLabel('');
      },
      [onCommand],
    ),
  );
  const { run } = action;
  const changeLabel = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setLabel(event.target.value);
  }, []);
  const create = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (label.trim()) {
        run('checkpoints', { expectedBranchId: work.state.branchId, label: label.trim() });
      }
    },
    [label, run, work.state.branchId],
  );
  const openResetTasks = useCallback((): void => {
    setConfirmation('reset-tasks');
  }, []);
  const openResetContext = useCallback((): void => {
    setConfirmation('reset-context');
  }, []);
  const openRestore = useCallback((): void => {
    setConfirmation('restore');
  }, []);
  const changeConfirmation = useCallback((open: boolean): void => {
    if (!open) {
      setConfirmation(null);
    }
  }, []);
  const confirm = useCallback((): void => {
    if (confirmation === 'reset-tasks' || confirmation === 'reset-context') {
      run(confirmation, { expectedBranchId: work.state.branchId, revision: work.state.revision });
    }
    if (confirmation === 'restore' && rightId !== 'current') {
      run(`checkpoints/${encodeURIComponent(rightId)}/restore`, {
        expectedBranchId: work.state.branchId,
        revision: work.state.revision,
      });
    }
  }, [confirmation, rightId, run, work.state.branchId, work.state.revision]);
  const current = {
    state: work.state,
    messageIds: session.messages.map((message) => {
      return message.id;
    }),
  };
  const resolve = (id: string): ComparisonState => {
    const checkpoint = work.checkpoints.find((entry) => {
      return entry.id === id;
    });
    if (checkpoint) {
      return checkpoint;
    }
    return current;
  };
  const differences = compareWork(resolve(leftId), resolve(rightId));
  let confirmTitle = '重置任务状态';
  let confirmDescription = '将清理计划和任务，保留上下文摘要及会话历史。';
  let confirmLabel = '确认重置';
  if (confirmation === 'reset-context') {
    confirmTitle = '重新开始上下文';
    confirmDescription =
      '将从下一条消息重新开始上下文，保留计划、任务和历史记录。此操作不回滚文件或命令。';
  }
  if (confirmation === 'restore') {
    confirmTitle = '恢复会话快照';
    confirmDescription =
      '将在新分支恢复所选消息前缀和工作状态，保留原分支历史。不会自动执行队列，也不会回滚磁盘文件、Shell 和外部请求。';
    confirmLabel = '创建分支并恢复';
  }
  return {
    label,
    changeLabel,
    create,
    leftId,
    setLeftId,
    rightId,
    setRightId,
    options: checkpointOptions(work.checkpoints),
    differences,
    action,
    openResetTasks,
    openResetContext,
    openRestore,
    confirmation,
    changeConfirmation,
    confirm,
    confirmTitle,
    confirmDescription,
    confirmLabel,
  };
};
