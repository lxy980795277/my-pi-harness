import type { SessionArchivePreview } from '@my-pi-harness/protocol';
import { useQuery } from '@tanstack/react-query';
import { PROVIDERS_QUERY_OPTIONS } from '@/features/models/queries/catalog';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';

interface ArchiveProviderReference {
  id: string;
  models: string;
  modelCount: number;
  omittedModels: number;
  availability: string;
}
interface ArchivePreviewState {
  providers: ArchiveProviderReference[];
  omittedProviders: number;
  plugins: string[];
  omittedPlugins: number;
  workspace: string;
}

/** Dependency references are informational; none are installed, authorized or selected automatically. */
export const useArchivePreview = (preview: SessionArchivePreview): ArchivePreviewState => {
  const providers = useQuery(PROVIDERS_QUERY_OPTIONS);
  const workspaces = useWorkspaces();
  const references = preview.manifest.dependencies;
  const rows = references.providers.slice(0, 20).map((reference): ArchiveProviderReference => {
    const current = providers.data?.find((item) => {
      return item.id === reference.providerId;
    });
    let availability = '本机未配置，不影响只读导入';
    if (providers.isPending) availability = '正在读取本机配置';
    if (providers.isError) availability = '本机配置读取失败，导入后可重新选择';
    if (current !== undefined) {
      availability = '本机配置当前不可用';
      if (current.enabled && current.configured) availability = '本机已配置，继续前仍需显式绑定';
    }
    return {
      id: reference.providerId,
      models: reference.modelIds.slice(0, 10).join(' · '),
      modelCount: reference.modelIds.length,
      omittedModels: Math.max(0, reference.modelIds.length - 10),
      availability,
    };
  });
  let workspace = '历史会话未使用工作区';
  if (references.workspace !== null) {
    workspace = references.workspace.name + ' · 本机需重新选择';
    if (
      workspaces.data?.some((item) => {
        return item.id === references.workspace?.workspaceId;
      }) === true
    )
      workspace = references.workspace.name + ' · 本机已存在，继续前仍需显式选择';
  }
  return {
    providers: rows,
    omittedProviders: Math.max(0, references.providers.length - rows.length),
    plugins: references.plugins.slice(0, 20),
    omittedPlugins: Math.max(0, references.plugins.length - 20),
    workspace,
  };
};
