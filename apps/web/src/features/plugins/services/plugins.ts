import { Type } from 'typebox';
import { PluginViewSchema, type PluginView } from '@my-pi-harness/protocol';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';
/** Catalog reads finite built-in manifests and their exact installed references. */
export const fetchPlugins = async (signal: AbortSignal): Promise<PluginView[]> => {
  return parseResponse(Type.Array(PluginViewSchema), await getJson('/plugins', signal));
};
export const installPlugin = async (id: string, signal: AbortSignal): Promise<PluginView> => {
  return parseResponse(
    PluginViewSchema,
    await requestJson(
      `/plugins/${encodeURIComponent(id)}/install`,
      'POST',
      undefined,
      signal,
      120000,
    ),
  );
};
export const setPluginEnabled = async (
  plugin: PluginView,
  enabled: boolean,
  signal: AbortSignal,
): Promise<PluginView> => {
  return parseResponse(
    PluginViewSchema,
    await requestJson(
      `/plugins/${encodeURIComponent(plugin.manifest.id)}/control`,
      'POST',
      { expectedRevision: plugin.revision, enabled },
      signal,
    ),
  );
};
export const setPluginComponentEnabled = async (
  plugin: PluginView,
  componentId: string,
  enabled: boolean,
  signal: AbortSignal,
): Promise<PluginView> => {
  return parseResponse(
    PluginViewSchema,
    await requestJson(
      `/plugins/${encodeURIComponent(plugin.manifest.id)}/components/${encodeURIComponent(componentId)}`,
      'POST',
      { expectedRevision: plugin.revision, enabled },
      signal,
    ),
  );
};
export const removePlugin = async (plugin: PluginView, signal: AbortSignal): Promise<void> => {
  await requestJson(
    `/plugins/${encodeURIComponent(plugin.manifest.id)}`,
    'DELETE',
    { expectedRevision: plugin.revision },
    signal,
  );
};
