import type { FC } from 'react';
import { ArchiveDialog } from '@/features/archives/components/archive-dialog';
import { useArchiveStore } from '@/features/archives/stores/archives';

/** Unmounting on authorization loss releases private File and Query owners. */
export const ArchiveHost: FC = () => {
  const mode = useArchiveStore((state) => {
    return state.mode;
  });
  const sessionId = useArchiveStore((state) => {
    return state.sessionId;
  });
  if (mode === null) return null;
  return <ArchiveDialog key={mode + ':' + sessionId} mode={mode} sessionId={sessionId} />;
};
