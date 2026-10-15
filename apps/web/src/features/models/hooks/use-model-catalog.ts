import type {
  AppSettings,
  ModelInfo,
  NativeProviderInfo,
  ProviderConfig,
} from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  fetchAppSettings,
  fetchProviderCatalog,
  fetchProviderModels,
  fetchProviders,
} from '@/features/models/services/providers';

export interface ModelCatalog {
  providers: UseQueryResult<ProviderConfig[], Error>;
  nativeProviders: UseQueryResult<NativeProviderInfo[], Error>;
  settings: UseQueryResult<AppSettings, Error>;
}

/** Public settings reads share the same cache across dialogs and session creation. */
export const useModelCatalog = (): ModelCatalog => {
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: ({ signal }): Promise<ProviderConfig[]> => {
      return fetchProviders(signal);
    },
  });
  const nativeProviders = useQuery({
    queryKey: ['provider-catalog'],
    queryFn: ({ signal }): Promise<NativeProviderInfo[]> => {
      return fetchProviderCatalog(signal);
    },
  });
  const settings = useQuery({
    queryKey: ['app-settings'],
    queryFn: ({ signal }): Promise<AppSettings> => {
      return fetchAppSettings(signal);
    },
  });
  return { providers, nativeProviders, settings };
};

/** Model capabilities are fetched for this exact configuration revision. */
export const useProviderModels = (
  providerId: string,
  revision: number | undefined,
  enabled = true,
): UseQueryResult<ModelInfo[], Error> => {
  return useQuery({
    queryKey: ['provider-models', providerId, revision],
    queryFn: ({ signal }): Promise<ModelInfo[]> => {
      return fetchProviderModels(providerId, signal);
    },
    enabled: enabled && providerId.length > 0,
  });
};
