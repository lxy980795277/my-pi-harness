import { queryOptions } from '@tanstack/react-query';
import { fetchAppSettings, fetchProviders } from '@/features/models/services/providers';

/** Reuses startup configuration when the workspace or settings dialog mounts. */
export const PROVIDERS_QUERY_OPTIONS = queryOptions({
  queryKey: ['providers'],
  queryFn: ({ signal }) => {
    return fetchProviders(signal);
  },
  staleTime: 15_000,
});

/** The default model is available before the new-conversation composer appears. */
export const APP_SETTINGS_QUERY_OPTIONS = queryOptions({
  queryKey: ['app-settings'],
  queryFn: ({ signal }) => {
    return fetchAppSettings(signal);
  },
  staleTime: 15_000,
});
