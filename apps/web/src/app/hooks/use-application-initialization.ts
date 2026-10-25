import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ApplicationInitialization } from '@/app/types/initialization';
import {
  APP_SETTINGS_QUERY_OPTIONS,
  PROVIDERS_QUERY_OPTIONS,
} from '@/features/models/queries/catalog';
import { useHealth } from '@/features/runtime/queries/health';
import { describeHealthError } from '@/features/runtime/utils/health-error';
import { SESSIONS_QUERY_OPTIONS } from '@/features/sessions/queries/sessions';
import { WORKSPACES_QUERY_OPTIONS } from '@/features/workspaces/queries/workspaces';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { describeError } from '@/utils/describe-error';

/** Holds the first workspace paint until authenticated, protocol-validated data is available. */
export const useApplicationInitialization = (authorized: boolean): ApplicationInitialization => {
  const health = useHealth(authorized);
  const enabled = authorized && health.isSuccess && !health.isStale;
  const workspaces = useQuery({ ...WORKSPACES_QUERY_OPTIONS, enabled });
  const sessions = useQuery({ ...SESSIONS_QUERY_OPTIONS, enabled });
  const providers = useQuery({ ...PROVIDERS_QUERY_OPTIONS, enabled });
  const settings = useQuery({ ...APP_SETTINGS_QUERY_OPTIONS, enabled });
  const { refetch: refetchHealth } = health;
  const { refetch: refetchWorkspaces } = workspaces;
  const { refetch: refetchSessions } = sessions;
  const { refetch: refetchProviders } = providers;
  const { refetch: refetchSettings } = settings;
  const retry = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      if (!health.isSuccess) {
        await refetchHealth();
        return;
      }
      await Promise.all([
        refetchWorkspaces(),
        refetchSessions(),
        refetchProviders(),
        refetchSettings(),
      ]);
    }, [
      health.isSuccess,
      refetchHealth,
      refetchProviders,
      refetchSessions,
      refetchSettings,
      refetchWorkspaces,
    ]),
  );

  if (!authorized) {
    return { state: { status: 'loading', stage: 'authorization' }, retry: retry.run };
  }
  if (health.isError) {
    if (health.isFetching) {
      return { state: { status: 'loading', stage: 'service' }, retry: retry.run };
    }
    return {
      state: { status: 'error', stage: 'service', message: describeHealthError(health.error) },
      retry: retry.run,
    };
  }
  if (!health.isSuccess || health.isStale) {
    return { state: { status: 'loading', stage: 'service' }, retry: retry.run };
  }

  const required = [workspaces, sessions, providers, settings];
  const failed = required.find((query) => {
    return query.data === undefined && query.isError && !query.isFetching;
  });
  if (failed !== undefined) {
    return {
      state: { status: 'error', stage: 'workspace', message: describeError(failed.error) },
      retry: retry.run,
    };
  }
  const incomplete = required.some((query) => {
    return query.data === undefined;
  });
  if (incomplete) {
    return { state: { status: 'loading', stage: 'workspace' }, retry: retry.run };
  }
  return { state: { status: 'ready' }, retry: retry.run };
};
