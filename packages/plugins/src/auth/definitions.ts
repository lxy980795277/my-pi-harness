import { PluginError } from '../plugins/errors';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_PLUGINS, BUILTIN_PLUGIN_RESOURCE_DIRECTORY } from '../plugins/index';
import { parsePluginConnectionManifest, type PluginConnectionDefinition } from './manifest';

/** Finite packaged OAuth declarations are validated independently of installed copies. */
export const PLUGIN_CONNECTION_DEFINITIONS: readonly PluginConnectionDefinition[] =
  BUILTIN_PLUGINS.filter((plugin) => plugin.category === 'services').map((plugin) => {
    const path = join(BUILTIN_PLUGIN_RESOURCE_DIRECTORY, plugin.id, 'manifest.yaml');
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || file.size > 65536)
      throw new PluginError('PLUGIN_MANIFEST_INVALID', '插件 OAuth 或网关配置无效。');
    return parsePluginConnectionManifest(readFileSync(path, 'utf8'), plugin.id);
  });

/** Resolve the packaged declaration; installation and authorization remain service decisions. */
export function pluginConnectionDefinition(id: string): PluginConnectionDefinition {
  const definition = PLUGIN_CONNECTION_DEFINITIONS.find((entry) => entry.id === id);
  if (definition === undefined)
    throw new PluginError('SKILL_COLLECTION_NOT_FOUND', '此插件不提供服务授权。');
  return definition;
}
