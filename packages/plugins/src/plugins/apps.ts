import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ConnectionServiceIdSchema, RemoteMcpTransportSchema } from '@my-pi-harness/protocol';
import { PluginError } from './errors';
import { isIP } from 'node:net';
import { isPublicAddress } from '@my-pi-harness/sandbox';

export type BuiltinPluginApp = Static<typeof AppSchema>;

export interface OwnedBuiltinPluginApp extends BuiltinPluginApp {
  pluginId: string;
}

const object = { additionalProperties: false } as const;

const AppSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
    provider: ConnectionServiceIdSchema,
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.String({ minLength: 1, maxLength: 1024 }),
    credentialSource: Type.Enum(['plugin-oauth', 'mcp-oauth', 'none']),
    transport: RemoteMcpTransportSchema,
    endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
  },
  object,
);

const AppsSchema = Type.Object({ apps: Type.Array(AppSchema, { maxItems: 32 }) }, object);
const resourceDirectory = fileURLToPath(new URL('./', import.meta.url));

function invalid(): never {
  throw new PluginError('PLUGIN_APPS_INVALID', '插件应用声明无效。');
}

/** Host-owned App declarations contain configuration only; credential values and executable entries are rejected. */
export function parseBuiltinPluginApps(source: string, pluginId: string): BuiltinPluginApp[] {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(pluginId) || Buffer.byteLength(source) > 65536)
    return invalid();
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return invalid();
  }
  if (!Value.Check(AppsSchema, value)) return invalid();
  const ids = new Set<string>();
  for (const app of value.apps) {
    if (
      app.provider !== pluginId ||
      (app.id !== pluginId && !app.id.startsWith(`${pluginId}-`)) ||
      ids.has(app.id)
    )
      return invalid();
    ids.add(app.id);
    try {
      const endpoint = new URL(app.endpoint);
      const hostname = endpoint.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (
        endpoint.protocol !== 'https:' ||
        (endpoint.port !== '' && endpoint.port !== '443') ||
        endpoint.username !== '' ||
        endpoint.password !== '' ||
        endpoint.hash !== '' ||
        endpoint.search !== '' ||
        hostname === 'localhost' ||
        ['.localhost', '.local', '.internal'].some((suffix) => hostname.endsWith(suffix)) ||
        (isIP(hostname) !== 0 && !isPublicAddress(hostname))
      )
        return invalid();
    } catch {
      return invalid();
    }
  }
  return value.apps;
}

/** Reads a bounded regular App declaration from the plugin's source directory. */
export function loadBuiltinPluginApps(
  pluginId: string,
  directory = resourceDirectory,
): BuiltinPluginApp[] {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(pluginId)) return invalid();
  const path = join(directory, pluginId, '.app.json');
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65536) return invalid();
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
  } catch {
    return invalid();
  }
  return parseBuiltinPluginApps(source, pluginId);
}
