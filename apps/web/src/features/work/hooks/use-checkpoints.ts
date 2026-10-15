import type { CheckpointView } from '@/features/work/types/work-view';
import type { Checkpoint, SessionSnapshot, WorkSnapshot } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
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
  const [confirmation, setConfirmation] = useState<'reset' | 'restore' | null>(null);
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
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (label.trim()) {
        run('checkpoints', { expectedBranchId: work.state.branchId, label: label.trim() });
      }
    },
    [label, run, work.state.branchId],
  );
  const openReset = useCallback((): void => {
    setConfirmation('reset');
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
    if (confirmation === 'reset') {
      run('reset', { expectedBranchId: work.state.branchId, revision: work.state.revision });
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
  const resolve = (id: string): typeof current | Checkpoint => {
    const checkpoint = work.checkpoints.find((entry) => {
      return entry.id === id;
    });
    if (checkpoint) {
      return checkpoint;
    }
    return current;
  };
  const differences = compareWork(resolve(leftId), resolve(rightId));
  let confirmTitle = '重置工作状态';
  let confirmDescription =
    '将清理当前上下文选择、摘要、计划、任务和未消费队列，保留会话历史。磁盘文件、Shell 和外部请求不会回滚。';
  let confirmLabel = '确认重置';
  if (confirmation === 'restore') {
    confirmTitle = '恢复检查点';
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
    openReset,
    openRestore,
    confirmation,
    changeConfirmation,
    confirm,
    confirmTitle,
    confirmDescription,
    confirmLabel,
  };
};
