import type { ConnectionServiceId } from '@my-pi-harness/protocol';
import type { OAuthDefinition } from '@my-pi-harness/integrations';
import { pluginConnectionDefinition } from '../auth/definitions';

export interface ConnectionProvider extends OAuthDefinition {
  serviceId: ConnectionServiceId;
  name: string;
  profileEndpoint: string;
  defaultScopes: readonly string[];
  allowedScopes: readonly string[];
}

const googleScopes = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
];

const accountPolicies = [
  {
    serviceId: 'github',
    name: 'GitHub',
    profilePath: '/user',
    defaultScopes: ['read:user', 'repo'],
    allowedScopes: ['read:user', 'repo', 'public_repo', 'read:org', 'workflow', 'offline_access'],
  },
  {
    serviceId: 'google',
    name: 'Google Workspace',
    profilePath: '/oauth2/v3/userinfo',
    defaultScopes: googleScopes,
    allowedScopes: [
      ...googleScopes,
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/documents.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/presentations.readonly',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ],
  },
  {
    serviceId: 'vercel',
    name: 'Vercel',
    profilePath: '/v2/user',
    tokenAuth: 'basic',
    defaultScopes: ['offline_access'],
    allowedScopes: ['offline_access', 'openid', 'profile', 'email'],
  },
  {
    serviceId: 'notion',
    name: 'Notion',
    profilePath: '/v1/users/me',
    defaultScopes: [],
    allowedScopes: [],
  },
  {
    serviceId: 'supabase',
    name: 'Supabase',
    profilePath: '/v1/profile',
    defaultScopes: [],
    allowedScopes: [],
  },
] as const;

/** Account policies share fixed provider endpoints with the plugin declaration. */
export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = accountPolicies.map((policy) => {
  const declaration = pluginConnectionDefinition(policy.serviceId);
  return {
    id: policy.serviceId,
    serviceId: policy.serviceId,
    name: policy.name,
    apiUrl: declaration.apiUrl,
    oauth: {
      ...declaration.oauth,
      tokenAuth: 'tokenAuth' in policy ? policy.tokenAuth : declaration.oauth.tokenAuth,
    },
    profileEndpoint: new URL(policy.profilePath, declaration.apiUrl).toString(),
    defaultScopes: policy.defaultScopes,
    allowedScopes: policy.allowedScopes,
  };
});

export function connectionProvider(id: ConnectionServiceId): ConnectionProvider {
  const provider = CONNECTION_PROVIDERS.find((item) => item.serviceId === id);
  if (provider === undefined) throw new Error('Unknown connection provider');
  return provider;
}
