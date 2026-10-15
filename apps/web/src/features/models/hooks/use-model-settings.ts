import type { ModelSettingsState } from '@/features/models/types/model-view';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { useModelCatalog } from '@/features/models/hooks/use-model-catalog';
import { setProviderEnabled } from '@/features/models/services/providers';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type { ProviderConfig } from '@my-pi-harness/protocol';

/** Dialog selections contain ids; current provider facts always come from Query. */
export const useModelSettings = (): ModelSettingsState => {
  const catalog = useModelCatalog();
  const client = useQueryClient();
  const providerId = useWorkspaceStore((state) => {
    return state.providerDialogId;
  });
  const modelsId = useWorkspaceStore((state) => {
    return state.modelsDialogId;
  });
  const openProvider = useWorkspaceStore((state) => {
    return state.openProvider;
  });
  const openModels = useWorkspaceStore((state) => {
    return state.openModels;
  });
  const closeModels = useWorkspaceStore((state) => {
    return state.closeModels;
  });
  const addProvider = useCallback((): void => {
    openProvider('new');
  }, [openProvider]);
  const modelsOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) {
        closeModels();
      }
    },
    [closeModels],
  );
  const toggle = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, provider: ProviderConfig, enabled: boolean): Promise<void> => {
        await setProviderEnabled(provider, enabled, signal);
        await client.invalidateQueries({ queryKey: ['providers'] });
      },
      [client],
    ),
  );
  const provider =
    catalog.providers.data?.find((item) => {
      return item.id === providerId;
    }) ?? null;
  const modelsProvider =
    catalog.providers.data?.find((item) => {
      return item.id === modelsId;
    }) ?? null;
  const native = catalog.nativeProviders.data?.find((item) => {
    return item.id === provider?.builtinId;
  });
  const configuredCount =
    catalog.providers.data?.filter((item) => {
      return item.configured;
    }).length ?? 0;
  const availableModelCount =
    catalog.providers.data
      ?.filter((item) => {
        return item.enabled && item.configured;
      })
      .reduce((count, item) => {
        return count + item.models.length;
      }, 0) ?? 0;
  const providerMissing =
    providerId !== null && providerId !== 'new' && provider === null && catalog.providers.isSuccess;
  return {
    configuredCount,
    availableModelCount,
    providerMissing,
    ...catalog,
    providerId,
    provider,
    modelsProvider,
    native,
    addProvider,
    openProvider,
    openModels,
    closeModels,
    modelsOpenChange,
    toggle: toggle.run,
    toggling: toggle.pending,
    error: toggle.error,
  };
};
