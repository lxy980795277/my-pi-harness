import { Type } from 'typebox';
import {
  ConnectionViewSchema,
  ConnectionProviderViewSchema,
  type ConnectionView,
  type ConnectionInput,
  type ConnectionUpdate,
  type ConnectionProviderView,
  type ConnectionControl,
} from '@my-pi-harness/protocol';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';
import type { ConnectionAction } from '@/features/connections/types/connection';
const path = (id: string): string => {
  return `/connections/${encodeURIComponent(id)}`;
};
const control = (connection: ConnectionView): ConnectionControl => {
  return { expectedRevision: connection.revision, expectedAccessEpoch: connection.accessEpoch };
};
export const fetchConnections = async (signal: AbortSignal): Promise<ConnectionView[]> => {
  return parseResponse(Type.Array(ConnectionViewSchema), await getJson('/connections', signal));
};
export const fetchConnectionProviders = async (
  signal: AbortSignal,
): Promise<ConnectionProviderView[]> => {
  return parseResponse(
    Type.Array(ConnectionProviderViewSchema),
    await getJson('/connections/providers', signal),
  );
};
export const createConnection = async (
  input: ConnectionInput,
  signal: AbortSignal,
): Promise<ConnectionView> => {
  return parseResponse(
    ConnectionViewSchema,
    await requestJson('/connections', 'POST', input, signal),
  );
};
export const updateConnection = async (
  id: string,
  input: ConnectionUpdate,
  signal: AbortSignal,
): Promise<ConnectionView> => {
  return parseResponse(ConnectionViewSchema, await requestJson(path(id), 'PUT', input, signal));
};
export const removeConnection = async (
  connection: ConnectionView,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(path(connection.id), 'DELETE', control(connection), signal);
};
/** Secret values are direct transient request arguments, never Query mutation variables. */
export const saveConnectionSecret = async (
  connection: ConnectionView,
  value: string,
  signal: AbortSignal,
): Promise<ConnectionView> => {
  let suffix = 'token';
  if (connection.authMode === 'oauth') {
    suffix = 'client-secret';
  }
  return parseResponse(
    ConnectionViewSchema,
    await requestJson(
      `${path(connection.id)}/${suffix}`,
      'POST',
      { ...control(connection), value },
      signal,
      45000,
    ),
  );
};
export const connectionAction = async (
  connection: ConnectionView,
  action: ConnectionAction,
  signal: AbortSignal,
): Promise<unknown> => {
  return await requestJson(
    `${path(connection.id)}/${action}`,
    'POST',
    control(connection),
    signal,
    45000,
  );
};
