import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PluginView } from '@my-pi-harness/protocol';
import { fetchRemoteMcpServers } from '@/features/mcp/services/remote-mcp';
import { fetchPluginAuthorization } from '@/features/plugins/services/plugin-authorization';
import { pluginAppConnectionLabel } from '@/features/plugins/utils/plugin-connections';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  fetchPlugins,
  fetchPluginDetail,
  installPlugin,
  setPluginEnabled,
  setPluginComponentEnabled,
  removePlugin,
} from '@/features/plugins/services/plugins';
import type {
  PluginAction,
  PluginAppRow,
  PluginCategoryFilter,
  PluginPage,
  PluginSettingsRow,
  PluginSettingsState,
  PluginSkillRow,
} from '@/features/plugins/types/plugin';

const OPTIONS = [
  { value: 'all', label: '全部插件' },
  { value: 'services', label: '在线服务' },
  { value: 'office', label: '办公文档' },
];

/** Query owns server facts; navigation and category belong to this mounted settings section. */
export const usePluginSettings = (): PluginSettingsState => {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<PluginCategoryFilter>('all');
  const [page, setPage] = useState<PluginPage>({ type: 'market' });
  let pluginId: string | null = null;
  if (page.type !== 'market') pluginId = page.pluginId;
  const catalog = useQuery({
    queryKey: ['plugins'],
    queryFn: ({ signal }) => {
      return fetchPlugins(signal);
    },
  });
  const detail = useQuery({
    queryKey: ['plugins', pluginId],
    queryFn: ({ signal }) => {
      if (pluginId === null) throw new Error('未选择插件');
      return fetchPluginDetail(pluginId, signal);
    },
    enabled: pluginId !== null,
  });
  let plugin = catalog.data?.find((entry) => {
    return entry.manifest.id === pluginId;
  });
  if (detail.data !== undefined) plugin = detail.data.plugin;
  const needsRemote = plugin !== undefined && plugin.installed && plugin.manifest.apps.length > 0;
  const usesPluginAuthorization =
    plugin !== undefined &&
    plugin.manifest.apps.some((app) => {
      return app.credentialSource === 'plugin-oauth';
    });
  const remote = useQuery({
    queryKey: ['mcp', 'remote-servers'],
    queryFn: ({ signal }) => {
      return fetchRemoteMcpServers(signal);
    },
    enabled: needsRemote,
    refetchInterval: (query) => {
      if (
        query.state.data?.some((server) => {
          return server.catalogStatus === 'loading';
        })
      )
        return 1000;
      return false;
    },
  });
  const authorization = useQuery({
    queryKey: ['skill-connections', pluginId],
    queryFn: ({ signal }) => {
      if (pluginId === null) throw new Error('未选择插件');
      return fetchPluginAuthorization(pluginId, signal);
    },
    enabled: needsRemote && usesPluginAuthorization,
  });
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['plugins'] }),
      queryClient.invalidateQueries({ queryKey: ['skills'] }),
      queryClient.invalidateQueries({ queryKey: ['mcp'] }),
    ]);
  }, [queryClient]);
  const operation = useAsyncEvent(
    useCallback(
      async (
        signal: AbortSignal,
        action: PluginAction,
        current: PluginView,
        componentId?: string,
        enabled?: boolean,
      ): Promise<void> => {
        try {
          if (action === 'install') await installPlugin(current.manifest.id, signal);
          if (action === 'toggle') await setPluginEnabled(current, !current.enabled, signal);
          if (action === 'remove') await removePlugin(current, signal);
          if (action === 'component' && componentId !== undefined && enabled !== undefined)
            await setPluginComponentEnabled(current, componentId, enabled, signal);
        } finally {
          await refresh();
        }
      },
      [refresh],
    ),
  );
  const { clearError } = operation;
  const retry = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      clearError();
      await refresh();
    }, [clearError, refresh]),
  );
  const createRow = (current: PluginView): PluginSettingsRow => {
    return {
      plugin: current,
      open: (): void => {
        clearError();
        setPage({ type: 'plugin', pluginId: current.manifest.id });
      },
      install: (): void => {
        operation.run('install', current);
      },
      toggle: (): void => {
        operation.run('toggle', current);
      },
      remove: (): void => {
        operation.run('remove', current);
      },
    };
  };
  const rows = (catalog.data ?? [])
    .filter((entry) => {
      return category === 'all' || entry.manifest.category === category;
    })
    .map(createRow);
  let selected: PluginSettingsRow | null = null;
  if (plugin !== undefined) selected = createRow(plugin);
  const skills: PluginSkillRow[] = (detail.data?.skills ?? []).map((skill) => {
    const current = plugin;
    const component = current?.components.find((entry) => {
      return entry.id === `skill:${skill.name}`;
    });
    return {
      ...skill,
      enabled: component !== undefined && component.enabled,
      disabled:
        operation.pending || current === undefined || !current.installed || component === undefined,
      open: (): void => {
        if (current === undefined) return;
        clearError();
        setPage({ type: 'skill', pluginId: current.manifest.id, skillName: skill.name });
      },
      change: (): void => {
        if (current !== undefined && component !== undefined)
          operation.run('component', current, component.id, !component.enabled);
      },
    };
  });
  const apps = (plugin?.manifest.apps ?? []).map((app) => {
    const current = plugin;
    const usesPluginOAuth = app.credentialSource === 'plugin-oauth';
    const component = current?.components.find((entry) => {
      return entry.kind === 'app' && entry.id === app.id;
    });
    const server = remote.data?.find((entry) => {
      return entry.id === component?.referenceId;
    });
    const enabled = component !== undefined && component.enabled && server?.enabled === true;
    let status = '安装后可配置';
    if (current?.installed) {
      status = '所属配置已移除';
      if (server !== undefined) {
        status = pluginAppConnectionLabel(server, authorization.data ?? null, usesPluginOAuth);
        if (usesPluginOAuth && server.enabled) {
          if (authorization.isPending) status = '正在读取授权';
          if (authorization.error !== null) status = '读取授权失败';
        }
      }
      if (remote.isPending) status = '正在读取配置';
      if (remote.error !== null) status = '读取配置失败';
      if (!current.enabled) status = '插件已停用';
      else if (component !== undefined && !component.enabled) status = '未开启';
      else if (server !== undefined && !server.enabled) status = '需要重新开启';
    }
    let description = `使用已授权的 ${app.name} 资源。`;
    if (current !== undefined && current.manifest.apps.length === 1)
      description = current.manifest.description;
    if (app.description !== undefined) description = app.description;
    return {
      id: app.id,
      name: app.name,
      description,
      enabled,
      disabled:
        operation.pending ||
        remote.isPending ||
        current === undefined ||
        !current.installed ||
        component === undefined,
      status,
      server: server ?? null,
      usesPluginOAuth,
      open: (): void => {
        if (current === undefined) return;
        clearError();
        setPage({ type: 'app', pluginId: current.manifest.id, appId: app.id });
      },
      change: (): void => {
        if (current !== undefined && component !== undefined)
          operation.run('component', current, component.id, !enabled);
      },
    };
  });
  let activeSkill: PluginSkillRow | null = null;
  let activeApp: PluginAppRow | null = null;
  let pageKey = 'market';
  let pageLabel = '插件市场';
  let backLabel = '返回插件市场';
  if (page.type !== 'market') {
    pageKey = page.pluginId;
    pageLabel = '插件详情';
  }
  if (page.type === 'skill') {
    activeSkill =
      skills.find((entry) => {
        return entry.name === page.skillName;
      }) ?? null;
    pageKey += `:${page.skillName}`;
    pageLabel = 'Skill 详情';
    if (plugin !== undefined) backLabel = `返回 ${plugin.manifest.name}`;
  }
  if (page.type === 'app') {
    activeApp =
      apps.find((entry) => {
        return entry.id === page.appId;
      }) ?? null;
    pageKey += `:app:${page.appId}`;
    pageLabel = '应用详情';
    if (plugin !== undefined) backLabel = `返回 ${plugin.manifest.name}`;
  }
  const back = (): void => {
    clearError();
    if (page.type === 'skill' || page.type === 'app')
      setPage({ type: 'plugin', pluginId: page.pluginId });
    else setPage({ type: 'market' });
  };
  const changeCategory = useCallback((value: string): void => {
    if (value === 'all' || value === 'services' || value === 'office') setCategory(value);
  }, []);
  const mountPage = useCallback((element: HTMLElement | null): void => {
    if (element === null) return;
    const viewport = element.closest('[data-radix-scroll-area-viewport]');
    if (viewport !== null) viewport.scrollTop = 0;
    element.focus({ preventScroll: true });
  }, []);
  let error = operation.error ?? retry.error;
  let loading = catalog.isPending;
  if (page.type === 'market') {
    if (error === null && catalog.error !== null) error = catalog.error.message;
  } else {
    loading = detail.isPending;
    if (error === null && detail.error !== null) error = detail.error.message;
    if (error === null && needsRemote && remote.error !== null) error = remote.error.message;
  }
  return {
    rows,
    selected,
    apps,
    skills,
    activeSkill,
    activeApp,
    page,
    pageKey,
    pageLabel,
    backLabel,
    back,
    mountPage,
    loading,
    error,
    retry: retry.run,
    pending: operation.pending,
    category,
    changeCategory,
    options: OPTIONS,
  };
};
