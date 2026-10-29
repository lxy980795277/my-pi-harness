import type { FC } from 'react';
import { TaskDialog } from '@/features/tasks/components/task-dialog';
import { useAgentUpdates } from '@/features/tasks/hooks/use-agent-updates';

/** Mounted once after authorization; logout closes the only task summary subscription. */
export const TaskHost: FC = () => {
  const connected = useAgentUpdates();
  return <TaskDialog connected={connected} />;
};
