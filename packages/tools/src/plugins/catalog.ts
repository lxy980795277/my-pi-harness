import { fileURLToPath } from 'node:url';
import type { PluginManifest } from '@my-pi-harness/protocol';
import { PluginError } from './errors.js';
import { loadBuiltinPluginApps, type OwnedBuiltinPluginApp } from './apps.js';

/** Plugin assets are co-located with their source modules in every runtime. */
export const BUILTIN_PLUGIN_RESOURCE_DIRECTORY = fileURLToPath(new URL('./', import.meta.url));

/** Finite plugin declarations load each App resource once before deriving public metadata. */
const builtinPlugins = [
  {
    id: 'github',
    name: 'GitHub',
    description: '管理代码仓库、Issue 与 Pull Request。',
    category: 'services' as const,
    version: '1.1.0',
    skills: ['github', 'github-reviews', 'github-actions', 'github-publish'],
  },
  {
    id: 'google',
    name: 'Google',
    description: '使用 Drive、Docs、Sheets、Slides 与 Calendar。',
    category: 'services' as const,
    version: '1.1.0',
    skills: [
      'google',
      'google-drive',
      'google-docs',
      'google-sheets',
      'google-slides',
      'google-calendar',
    ],
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: '检查项目、部署与构建状态。',
    category: 'services' as const,
    version: '1.0.0',
    skills: ['vercel'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: '查询和编辑授权范围中的页面与数据库。',
    category: 'services' as const,
    version: '1.0.0',
    skills: ['notion'],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: '检查 Supabase 项目、数据库与服务。',
    category: 'services' as const,
    version: '1.0.0',
    skills: ['supabase'],
  },
  {
    id: 'documents',
    name: 'Documents',
    description: '创建、检查和修改工作区内的 Word 文档。',
    category: 'office' as const,
    version: '1.1.0',
    skills: ['documents'],
  },
  {
    id: 'pdf',
    name: 'PDF',
    description: '创建、读取页面并处理 PDF 文件。',
    category: 'office' as const,
    version: '1.1.0',
    skills: ['pdf'],
  },
  {
    id: 'spreadsheets',
    name: 'Spreadsheets',
    description: '创建和核查工作簿、公式与图表。',
    category: 'office' as const,
    version: '1.0.0',
    skills: ['spreadsheets'],
  },
  {
    id: 'presentations',
    name: 'Presentations',
    description: '创建和核查原生幻灯片、表格与图表。',
    category: 'office' as const,
    version: '1.0.0',
    skills: ['presentations'],
  },
].map((plugin) => ({ ...plugin, apps: loadBuiltinPluginApps(plugin.id) }));

/** Public metadata excludes transport targets and contains no runtime authorization state. */
export const BUILTIN_PLUGINS: readonly PluginManifest[] = builtinPlugins.map((plugin) => ({
  ...plugin,
  apps: plugin.apps.map((app) => ({
    id: app.id,
    provider: app.provider,
    name: app.name,
    description: app.description,
    credentialSource: app.credentialSource,
  })),
}));

/** The same resource declarations supply public metadata and private, owner-bound MCP targets. */
export const BUILTIN_PLUGIN_APPS: readonly OwnedBuiltinPluginApp[] = builtinPlugins.flatMap(
  (plugin) => plugin.apps.map((app) => ({ ...app, pluginId: plugin.id })),
);

/** Catalog owns public manifests; the daemon owns configuration and installation state. */
export class PluginCatalog {
  private readonly manifests = new Map<string, PluginManifest>();
  public constructor(manifests: readonly PluginManifest[] = BUILTIN_PLUGINS) {
    for (const manifest of manifests) {
      if (this.manifests.has(manifest.id))
        throw new PluginError('PLUGIN_CONFLICT', 'Plugin identifier is duplicated');
      assertUniqueContributions(manifest);
      this.manifests.set(manifest.id, structuredClone(manifest));
    }
  }

  public list(): PluginManifest[] {
    return [...this.manifests.values()].map((manifest) => structuredClone(manifest));
  }

  public get(pluginId: string): PluginManifest {
    const manifest = this.manifests.get(pluginId);
    if (manifest === undefined) throw new PluginError('PLUGIN_NOT_FOUND', 'Unknown plugin');
    return structuredClone(manifest);
  }
}

function assertUniqueContributions(manifest: PluginManifest): void {
  if (
    new Set(manifest.skills).size !== manifest.skills.length ||
    new Set(manifest.apps.map((app) => app.id)).size !== manifest.apps.length ||
    manifest.skills.some((name) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
  )
    throw new PluginError(
      'PLUGIN_CONFLICT',
      'Plugin contributions contain duplicate or invalid identifiers',
    );
}
