import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PluginView } from '@my-pi-harness/protocol';
import { useSettingsStore } from '@/features/settings/stores/settings';
import { fetchRemoteMcpServers } from '@/features/mcp/services/remote-mcp';
import { pluginAppStatus } from '@/features/plugins/utils/plugin-status';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  fetchPlugins,
  installPlugin,
  setPluginEnabled,
  setPluginComponentEnabled,
  removePlugin,
} from '@/features/plugins/services/plugins';
import type {
  PluginAction,
  PluginCategoryFilter,
  PluginSettingsState,
} from '@/features/plugins/types/plugin';

const OPTIONS = [
  { value: 'all', label: '全部插件' },
  { value: 'services', label: '在线服务' },
  { value: 'office', label: '办公文档' },
];
/** Installation mutates daemon facts; category and open details stay local. */
export const usePluginSettings = (): PluginSettingsState => {
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ['plugins'],
    queryFn: ({ signal }) => {
      return fetchPlugins(signal);
    },
  });
  const openSettings = useSettingsStore((state) => {
    return state.openSettings;
  });
  const remote = useQuery({
    queryKey: ['mcp', 'remote-servers'],
    queryFn: ({ signal }) => {
      return fetchRemoteMcpServers(signal);
    },
  });
  const [category, setCategory] = useState<PluginCategoryFilter>('all');
  const operation = useAsyncEvent(
    useCallback(
      async (
        signal: AbortSignal,
        action: PluginAction,
        plugin: PluginView,
        componentId?: string,
        enabled?: boolean,
      ): Promise<void> => {
        if (action === 'install') await installPlugin(plugin.manifest.id, signal);
        if (action === 'toggle') await setPluginEnabled(plugin, !plugin.enabled, signal);
        if (action === 'remove') await removePlugin(plugin, signal);
        if (action === 'component' && componentId !== undefined && enabled !== undefined)
          await setPluginComponentEnabled(plugin, componentId, enabled, signal);
        await queryClient.invalidateQueries({ queryKey: ['plugins'] });
        await queryClient.invalidateQueries({ queryKey: ['skills'] });
        await queryClient.invalidateQueries({ queryKey: ['mcp'] });
      },
      [queryClient],
    ),
  );
  const rows = (catalog.data ?? [])
    .filter((plugin) => {
      return category === 'all' || plugin.manifest.category === category;
    })
    .map((plugin) => {
      return {
        plugin,
        install: (): void => {
          operation.run('install', plugin);
        },
        toggle: (): void => {
          operation.run('toggle', plugin);
        },
        remove: (): void => {
          operation.run('remove', plugin);
        },
        components: plugin.components.map((component) => {
          let label = 'Skill';
          if (component.kind === 'app') label = 'MCP App';
          const server = remote.data?.find((entry) => {
            return entry.id === component.referenceId;
          });
          let status = '';
          if (component.kind === 'app') status = pluginAppStatus(server, remote.isPending);
          return {
            id: component.id,
            label: `${label} · ${component.id.replace(/^skill:/, '')}`,
            enabled: component.enabled,
            isApp: component.kind === 'app',
            status,
            manage: (): void => {
              openSettings('mcp');
            },
            connections: (): void => {
              openSettings('connections');
            },
            change: (): void => {
              operation.run('component', plugin, component.id, !component.enabled);
            },
          };
        }),
      };
    });
  const changeCategory = useCallback((value: string): void => {
    if (value === 'all' || value === 'services' || value === 'office') setCategory(value);
  }, []);
  let error: string | null = operation.error;
  if (error === null && catalog.error !== null) error = catalog.error.message;
  if (error === null && remote.error !== null) error = remote.error.message;
  return {
    rows,
    loading: catalog.isPending,
    error,
    pending: operation.pending,
    category,
    changeCategory,
    options: OPTIONS,
  };
};
