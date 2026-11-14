import type { FC } from 'react';
import { FileChangeDialog } from '@/features/file-changes/components/file-change-dialog';
import { useFileChangesStore } from '@/features/file-changes/stores/file-changes';

/** One authorized host also serves tool details belonging to background child sessions. */
export const FileChangeHost: FC = () => {
  const sessionId = useFileChangesStore((state) => {
    return state.sessionId;
  });
  if (sessionId === null) return null;
  return <FileChangeDialog key={sessionId} sessionId={sessionId} />;
};
