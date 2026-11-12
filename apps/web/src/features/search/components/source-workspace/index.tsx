import type { FC } from 'react';
import { useSourceWorkspace } from '@/features/search/hooks/use-source-workspace';

interface SourceWorkspaceProps {
  workspaceId: string | null;
}

/** Precise historical identifiers are inspectable without filling the primary metadata with ids. */
export const SourceWorkspace: FC<SourceWorkspaceProps> = ({ workspaceId }) => {
  const state = useSourceWorkspace(workspaceId);
  return (
    <>
      <span>{state.label}</span>
      {state.detailId !== null && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">工作区标识</summary>
          <p className="mt-1 [overflow-wrap:anywhere]">{state.detailId}</p>
        </details>
      )}
    </>
  );
};
