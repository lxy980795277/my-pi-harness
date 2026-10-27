import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { parseDocument } from 'yaml';
import { SkillError } from '../skills/errors.js';
import { parseRemoteUrl } from '../remote-network.js';
import { BUILTIN_PLUGINS, BUILTIN_PLUGIN_RESOURCE_DIRECTORY } from './catalog.js';

/** Deployment-owned OAuth clients override the declarative plugin's client fields. */
export interface PluginOAuthClient {
  clientId: string;
  clientSecret: string;
  callbackUrl?: string;
}
export type PluginOAuthClients = Readonly<Record<string, PluginOAuthClient>>;
export interface PluginOAuthProfile {
  source: 'userinfo' | 'id-token' | 'token';
  path?: string;
  method?: 'GET' | 'POST';
  idField: string;
  usernameField: string;
  displayNameField?: string;
  avatarUrlField?: string;
}
export interface PluginConnectionDefinition {
  id: string;
  name: string;
  apiUrl: string;
  oauth: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    clientId?: string;
    clientSecret?: string;
    callbackUrl?: string;
    pkce: boolean;
    tokenAuth: 'body' | 'basic';
    tokenFormat: 'form' | 'json';
    scopes: readonly string[];
    authorizationParams?: Readonly<Record<string, string>>;
    profile?: PluginOAuthProfile;
  };
  gateway: {
    allowedPaths: readonly string[];
    headers?: Readonly<Record<string, string>>;
    deniedQueryValues?: Readonly<Record<string, readonly string[]>>;
    queryJsonPostPaths?: readonly string[];
  };
}

const object = { additionalProperties: false } as const;
const text = Type.String({ minLength: 1, maxLength: 4096 });
const fields = Type.Record(
  Type.String({ minLength: 1, maxLength: 100 }),
  Type.String({ maxLength: 4096 }),
  { maxProperties: 32 },
);
const paths = Type.Array(Type.String({ minLength: 3, maxLength: 2048 }), { maxItems: 64 });
const ManifestSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    apiUrl: text,
    oauth: Type.Object(
      {
        issuer: text,
        authorizationEndpoint: text,
        tokenEndpoint: text,
        clientId: Type.Optional(Type.String({ maxLength: 1000 })),
        clientSecret: Type.Optional(Type.String({ maxLength: 65536 })),
        callbackUrl: Type.Optional(text),
        pkce: Type.Boolean(),
        tokenAuth: Type.Enum(['body', 'basic']),
        tokenFormat: Type.Enum(['form', 'json']),
        scopes: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), {
          maxItems: 64,
          uniqueItems: true,
        }),
        authorizationParams: Type.Optional(fields),
        profile: Type.Optional(
          Type.Object(
            {
              source: Type.Enum(['userinfo', 'id-token', 'token']),
              path: Type.Optional(text),
              method: Type.Optional(Type.Enum(['GET', 'POST'])),
              idField: text,
              usernameField: text,
              displayNameField: Type.Optional(text),
              avatarUrlField: Type.Optional(text),
            },
            object,
          ),
        ),
      },
      object,
    ),
    gateway: Type.Object(
      {
        allowedPaths: paths,
        headers: Type.Optional(fields),
        deniedQueryValues: Type.Optional(
          Type.Record(
            Type.String({ minLength: 1, maxLength: 100 }),
            Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 32 }),
            { maxProperties: 32 },
          ),
        ),
        queryJsonPostPaths: Type.Optional(paths),
      },
      object,
    ),
  },
  object,
);
function invalid(): never {
  throw new SkillError('PLUGIN_MANIFEST_INVALID', '插件 OAuth 或网关配置无效。');
}
function httpsEndpoint(value: string): URL {
  let url: URL;
  try {
    url = parseRemoteUrl(value);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    (url.port !== '' && url.port !== '443')
  )
    return invalid();
  return url;
}

/** Host manifests accept only declarative OAuth and gateway data; no YAML aliases or executable tags. */
export function parsePluginConnectionManifest(
  source: string,
  pluginId: string,
): PluginConnectionDefinition {
  if (Buffer.byteLength(source) > 65536) return invalid();
  const document = parseDocument(source, { uniqueKeys: true, strict: true });
  if (document.errors.length > 0 || document.warnings.length > 0) return invalid();
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch {
    return invalid();
  }
  if (!Value.Check(ManifestSchema, value) || value.id !== pluginId) return invalid();
  const base = httpsEndpoint(value.apiUrl);
  if (base.pathname !== '/' || base.search !== '') return invalid();
  if (httpsEndpoint(value.oauth.issuer).search !== '') return invalid();
  for (const endpoint of [value.oauth.authorizationEndpoint, value.oauth.tokenEndpoint])
    httpsEndpoint(endpoint);
  if (value.oauth.profile?.source === 'userinfo') {
    const path = value.oauth.profile.path;
    if (
      path === undefined ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      new URL(path, base).origin !== base.origin
    )
      return invalid();
  }
  if (value.oauth.callbackUrl !== undefined) {
    let callback: URL;
    try {
      callback = new URL(value.oauth.callbackUrl);
    } catch {
      return invalid();
    }
    if (
      !['http:', 'https:'].includes(callback.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(callback.hostname) ||
      callback.username !== '' ||
      callback.password !== '' ||
      callback.search !== '' ||
      callback.hash !== '' ||
      callback.pathname !== `/api/skill-connections/${pluginId}/oauth/callback`
    )
      return invalid();
  }
  for (const path of [...value.gateway.allowedPaths, ...(value.gateway.queryJsonPostPaths ?? [])]) {
    if (!path.startsWith('^/') || !path.endsWith('$')) return invalid();
    try {
      new RegExp(path);
    } catch {
      return invalid();
    }
  }
  for (const name of Object.keys(value.gateway.headers ?? {}))
    if (
      !/^[A-Za-z0-9-]+$/.test(name) ||
      /^(?:authorization|cookie|host|connection|transfer-encoding|proxy-authorization)$/i.test(name)
    )
      return invalid();
  for (const name of Object.keys(value.oauth.authorizationParams ?? {}))
    if (
      [
        'client_id',
        'redirect_uri',
        'response_type',
        'state',
        'code_challenge',
        'code_challenge_method',
        'scope',
      ].includes(name)
    )
      return invalid();
  return value;
}

/** The finite packaged resource set is read once; clients are merged privately by the daemon. */
export const PLUGIN_CONNECTION_DEFINITIONS: readonly PluginConnectionDefinition[] =
  BUILTIN_PLUGINS.filter((plugin) => plugin.category === 'services').map((plugin) => {
    const path = join(BUILTIN_PLUGIN_RESOURCE_DIRECTORY, plugin.id, 'manifest.yaml');
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || file.size > 65536) return invalid();
    return parsePluginConnectionManifest(readFileSync(path, 'utf8'), plugin.id);
  });

export function pluginConnectionDefinition(id: string): PluginConnectionDefinition {
  const definition = PLUGIN_CONNECTION_DEFINITIONS.find((entry) => entry.id === id);
  if (definition === undefined)
    throw new SkillError('SKILL_COLLECTION_NOT_FOUND', '此插件不提供服务授权。');
  return definition;
}
