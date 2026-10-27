import { fileURLToPath } from 'node:url';
import {
  loadBuiltinPluginApps,
  publicBuiltinPluginApps,
  type OwnedBuiltinPluginApp,
} from './apps.js';

/** Resource location works from source, built workspace and packaged runtime. */
export const BUILTIN_PLUGIN_RESOURCE_DIRECTORY = fileURLToPath(
  new URL('../../resources/plugins/', import.meta.url),
);

/** Built-in plugin identifiers and resource declarations are finite, independently authored data. */
export const BUILTIN_PLUGINS = [
  {
    id: 'github',
    name: 'GitHub',
    description: '管理代码仓库、Issue 与 Pull Request。',
    category: 'services' as const,
    version: '1.1.0',
    skills: ['github', 'github-reviews', 'github-actions', 'github-publish'],
    apps: publicBuiltinPluginApps('github'),
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
    apps: publicBuiltinPluginApps('google'),
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: '检查项目、部署与构建状态。',
    category: 'services' as const,
    version: '1.0.0',
    skills: ['vercel'],
    apps: publicBuiltinPluginApps('vercel'),
  },
  {
    id: 'notion',
    name: 'Notion',
    description: '查询和编辑授权范围中的页面与数据库。',
    category: 'services' as const,
    version: '1.0.0',
    skills: ['notion'],
    apps: publicBuiltinPluginApps('notion'),
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: '检查 Supabase 项目、数据库与服务。',
    category: 'services' as const,
    version: '1.0.0',
    skills: ['supabase'],
    apps: publicBuiltinPluginApps('supabase'),
  },
  {
    id: 'documents',
    name: 'Documents',
    description: '创建、检查和修改工作区内的 Word 文档。',
    category: 'office' as const,
    version: '1.1.0',
    skills: ['documents'],
    apps: publicBuiltinPluginApps('documents'),
  },
  {
    id: 'pdf',
    name: 'PDF',
    description: '创建、读取页面并处理 PDF 文件。',
    category: 'office' as const,
    version: '1.1.0',
    skills: ['pdf'],
    apps: publicBuiltinPluginApps('pdf'),
  },
  {
    id: 'spreadsheets',
    name: 'Spreadsheets',
    description: '创建和核查工作簿、公式与图表。',
    category: 'office' as const,
    version: '1.0.0',
    skills: ['spreadsheets'],
    apps: publicBuiltinPluginApps('spreadsheets'),
  },
  {
    id: 'presentations',
    name: 'Presentations',
    description: '创建和核查原生幻灯片、表格与图表。',
    category: 'office' as const,
    version: '1.0.0',
    skills: ['presentations'],
    apps: publicBuiltinPluginApps('presentations'),
  },
];

/** The same resource declarations supply public metadata and private, owner-bound MCP targets. */
export const BUILTIN_PLUGIN_APPS: readonly OwnedBuiltinPluginApp[] = BUILTIN_PLUGINS.flatMap(
  (plugin) => loadBuiltinPluginApps(plugin.id).map((app) => ({ ...app, pluginId: plugin.id })),
);
