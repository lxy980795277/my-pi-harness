import { WebServiceStatusSchema, type WebServiceStatus } from '@my-pi-harness/protocol';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Reads availability without returning the service credential to the Renderer. */
export const fetchWebServiceStatus = async (signal: AbortSignal): Promise<WebServiceStatus> => {
  return parseResponse(WebServiceStatusSchema, await getJson('/web/status', signal));
};

/** Sends an ephemeral official DeepSeek key to the dedicated credential endpoint. */
export const saveWebCredential = async (
  apiKey: string,
  signal: AbortSignal,
): Promise<WebServiceStatus> => {
  return parseResponse(
    WebServiceStatusSchema,
    await requestJson('/web/credential', 'PUT', { apiKey }, signal),
  );
};

/** Removes the web service credential independently of chat model configuration. */
export const deleteWebCredential = async (signal: AbortSignal): Promise<WebServiceStatus> => {
  return parseResponse(
    WebServiceStatusSchema,
    await requestJson('/web/credential', 'DELETE', {}, signal),
  );
};
