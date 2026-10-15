import type { ProviderCardState } from '@/features/models/types/model-view';
import type { ProviderConfig } from '@my-pi-harness/protocol';
import { useCallback } from 'react';

/** Card labels summarize only public configuration and never derive credentials. */
export const useProviderCard = (
  provider: ProviderConfig,
  onOpen: (id: string) => void,
  onModels: (id: string) => void,
  onToggle: (provider: ProviderConfig, enabled: boolean) => void,
): ProviderCardState => {
  const configure = useCallback((): void => {
    onOpen(provider.id);
  }, [onOpen, provider.id]);
  const models = useCallback((): void => {
    onModels(provider.id);
  }, [onModels, provider.id]);
  const toggle = useCallback(
    (enabled: boolean): void => {
      onToggle(provider, enabled);
    },
    [onToggle, provider],
  );
  let authDescription = '尚未配置认证';
  if (provider.authSource === 'api_key') {
    authDescription = `API Key · ${provider.credentialPreview ?? '已安全保存'}`;
  }
  if (provider.authSource === 'oauth') {
    authDescription = 'OAuth · 已登录';
  }
  if (provider.authSource === 'none') {
    authDescription = '无需 API Key';
  }
  let subtitle = provider.baseUrl ?? '';
  if (provider.kind === 'builtin') {
    subtitle = `${provider.models.length} 个模型`;
  }
  return {
    subtitle,
    configure,
    models,
    toggle,
    authDescription,
    visibleModels: provider.models.slice(0, 8),
    remainingModels: Math.max(0, provider.models.length - 8),
  };
};
