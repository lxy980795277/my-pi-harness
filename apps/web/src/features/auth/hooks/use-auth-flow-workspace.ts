import type { AuthFlowWorkspaceState } from '@/features/auth/types/auth';
import type { AuthFlow } from '@my-pi-harness/protocol';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { fetchAuthFlows } from '@/features/auth/services/auth';
import { AUTH_STATUS_LABELS } from '@/features/auth/utils/oauth-view';

/** Global recovery is limited to application identity; provider dialogs own provider authentication. */
export const useAuthFlowWorkspace = (): AuthFlowWorkspaceState => {
  const activeId = useWorkspaceStore((state) => {
    return state.activeAuthFlowId;
  });
  const visible = useWorkspaceStore((state) => {
    return state.authFlowVisible;
  });
  const select = useWorkspaceStore((state) => {
    return state.selectAuthFlow;
  });
  const hide = useWorkspaceStore((state) => {
    return state.hideAuthFlow;
  });
  const query = useQuery({
    queryKey: ['auth-flows'],
    queryFn: ({ signal }): Promise<AuthFlow[]> => {
      return fetchAuthFlows(signal);
    },
    refetchInterval: (state): number | false => {
      if (
        state.state.data?.some((flow) => {
          return flow.providerId === 'application:github' && flow.status === 'pending';
        })
      ) {
        return 1000;
      }
      return false;
    },
  });
  const flows = useMemo(() => {
    const flows = query.data ?? [];
    return flows.filter((flow) => {
      return flow.providerId === 'application:github';
    });
  }, [query.data]);
  const active = flows.find((flow) => {
    return flow.id === activeId;
  });
  useEffect(() => {
    if (activeId === null) {
      const pending = flows.find((flow) => {
        return flow.status === 'pending';
      });
      if (pending) {
        select(pending.id);
      }
    }
  }, [activeId, flows, select]);
  const show = useCallback((): void => {
    if (active) {
      select(active.id);
    }
  }, [active, select]);
  const options = flows.map((flow) => {
    return { value: flow.id, label: `GitHub 应用身份 · ${AUTH_STATUS_LABELS[flow.status]}` };
  });
  return { query, options, activeId: active?.id ?? '', visible, select, hide, show };
};
