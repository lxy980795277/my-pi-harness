import { SessionUsageSchema, type SessionUsage, type UsageQuery } from '@my-pi-harness/protocol';
import { getJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** All usage views share the host's unique-request aggregation and scope rules. */
export const fetchUsage = async (
  sessionId: string,
  scope: UsageQuery,
  signal: AbortSignal,
): Promise<SessionUsage> => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(scope)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return parseResponse(
    SessionUsageSchema,
    await getJson(
      '/sessions/' + encodeURIComponent(sessionId) + '/usage?' + query.toString(),
      signal,
    ),
  );
};
