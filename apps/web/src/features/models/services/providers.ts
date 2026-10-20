import type { ProviderSaveMethod } from '@/features/models/types/model';
import {
  AuthFlowSchema,
  ModelInfoSchema,
  AppSettingsSchema,
  NativeProviderInfoSchema,
  ProviderConfigSchema,
  ConnectionResultSchema,
  type AuthFlow,
  type ModelInfo,
  type AppSettings,
  type AppSettingsInput,
  type NativeProviderInfo,
  type ProviderConfig,
  type ProviderInput,
  type ConnectionResult,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';

import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Lists publicly supported native providers and their declared authentication. */
export const fetchProviderCatalog = async (signal: AbortSignal): Promise<NativeProviderInfo[]> => {
  return parseResponse(
    Type.Array(NativeProviderInfoSchema),
    await getJson('/providers/catalog', signal),
  );
};

/** Reads configurations without resolving credentials into the Renderer. */
export const fetchProviders = async (signal: AbortSignal): Promise<ProviderConfig[]> => {
  return parseResponse(Type.Array(ProviderConfigSchema), await getJson('/providers', signal));
};

/** Saves a configuration using its optimistic revision when editing. */
export const saveProvider = async (
  input: ProviderInput,
  signal: AbortSignal,
): Promise<ProviderConfig> => {
  let path = '/providers';
  let method: ProviderSaveMethod = 'POST';
  if (input.id) {
    path = `/providers/${encodeURIComponent(input.id)}`;
    method = 'PUT';
  }
  return parseResponse(ProviderConfigSchema, await requestJson(path, method, input, signal));
};

/** Removes one configuration after the user explicitly selects delete. */
export const deleteProvider = async (id: string, signal: AbortSignal): Promise<void> => {
  await requestJson(`/providers/${encodeURIComponent(id)}`, 'DELETE', {}, signal);
};

/** Fetches this instance's available model definitions. */
export const fetchProviderModels = async (
  id: string,
  signal: AbortSignal,
): Promise<ModelInfo[]> => {
  return parseResponse(
    Type.Array(ModelInfoSchema),
    await getJson(`/providers/${encodeURIComponent(id)}/models`, signal),
  );
};

/** Native settings expose only an optimistic enabled update. */
export const setProviderEnabled = async (
  provider: ProviderConfig,
  enabled: boolean,
  signal: AbortSignal,
): Promise<ProviderConfig> => {
  return parseResponse(
    ProviderConfigSchema,
    await requestJson(
      `/providers/${encodeURIComponent(provider.id)}/enabled`,
      'PUT',
      { enabled, expectedRevision: provider.revision },
      signal,
    ),
  );
};

/** Reads the profile-wide default used for newly created sessions. */
export const fetchAppSettings = async (signal: AbortSignal): Promise<AppSettings> => {
  return parseResponse(AppSettingsSchema, await getJson('/settings', signal));
};

/** Stores an explicit default selection with a revision check. */
export const saveAppSettings = async (
  input: AppSettingsInput,
  signal: AbortSignal,
): Promise<AppSettings> => {
  return parseResponse(AppSettingsSchema, await requestJson('/settings', 'PUT', input, signal));
};

/** Writes an ephemeral API key through the dedicated credential endpoint. */
export const writeProviderKey = async (
  id: string,
  key: string,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(`/providers/${encodeURIComponent(id)}/key`, 'POST', { key }, signal);
};

/** Removes this instance's stored API key. */
export const deleteProviderKey = async (id: string, signal: AbortSignal): Promise<void> => {
  await requestJson(`/providers/${encodeURIComponent(id)}/key`, 'DELETE', {}, signal);
};

/** Starts the selected native provider's OAuth flow. */
export const startProviderAuth = async (id: string, signal: AbortSignal): Promise<AuthFlow> => {
  return parseResponse(
    AuthFlowSchema,
    await requestJson(
      `/providers/${encodeURIComponent(id)}/auth`,
      'POST',
      { kind: 'oauth' },
      signal,
    ),
  );
};

/** Revokes this instance's OAuth credentials; current runs keep their frozen state. */
export const logoutProvider = async (id: string, signal: AbortSignal): Promise<void> => {
  await requestJson(`/providers/${encodeURIComponent(id)}/logout`, 'POST', {}, signal);
};

/** Tests the exact selected configuration and model without creating a chat run. */
export const testProvider = async (
  id: string,
  modelId: string,
  signal: AbortSignal,
): Promise<ConnectionResult> => {
  return parseResponse(
    ConnectionResultSchema,
    await requestJson(
      `/providers/${encodeURIComponent(id)}/test`,
      'POST',
      { modelId },
      signal,
      45_000,
    ),
  );
};
