import {
  AuthFlowSchema,
  type AuthFlow,
  type AuthFlowResponseInput,
  type ProviderAuthInput,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';

import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Starts the selected native provider's OAuth flow. */
export const startProviderAuth = async (id: string, signal: AbortSignal): Promise<AuthFlow> => {
  return parseResponse(
    AuthFlowSchema,
    await requestJson(
      `/providers/${encodeURIComponent(id)}/auth`,
      'POST',
      { kind: 'oauth' } satisfies ProviderAuthInput,
      signal,
    ),
  );
};

/** Reads the server-owned model-provider OAuth flow. */
export const fetchAuthFlow = async (id: string, signal: AbortSignal): Promise<AuthFlow> => {
  return parseResponse(
    AuthFlowSchema,
    await getJson(`/auth-flows/${encodeURIComponent(id)}`, signal),
  );
};

/** Restores authorized model-provider flows after refresh without persisting client-side facts. */
export const fetchAuthFlows = async (signal: AbortSignal): Promise<AuthFlow[]> => {
  return parseResponse(Type.Array(AuthFlowSchema), await getJson('/auth-flows', signal));
};

/** Replies only to the exact pending OAuth challenge. */
export const respondToAuthFlow = async (
  id: string,
  promptId: string,
  value: string,
  signal: AbortSignal,
): Promise<AuthFlow> => {
  return parseResponse(
    AuthFlowSchema,
    await requestJson(
      `/auth-flows/${encodeURIComponent(id)}/respond`,
      'POST',
      { promptId, value } satisfies AuthFlowResponseInput,
      signal,
    ),
  );
};

/** Cancels a model-provider OAuth exchange without treating it as logout. */
export const cancelAuthFlow = async (id: string, signal: AbortSignal): Promise<void> => {
  await requestJson(`/auth-flows/${encodeURIComponent(id)}`, 'DELETE', {}, signal);
};
