import type { ConnectionServiceId } from '@my-pi-harness/protocol';
import { loadBuiltinPluginApps } from '../plugins/apps.js';

export type ClientAuthentication = 'basic' | 'post';
export interface ConnectionProvider {
  serviceId: ConnectionServiceId;
  name: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientAuthentication: ClientAuthentication;
  tokenJson: boolean;
  profileEndpoint: string;
  defaultScopes: readonly string[];
  allowedScopes: readonly string[];
  mcpEndpoints: readonly string[];
  apps: readonly string[];
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

const providers: readonly Omit<ConnectionProvider, 'mcpEndpoints' | 'apps'>[] = [
  {
    serviceId: 'github',
    name: 'GitHub',
    issuer: 'https://github.com/login/oauth',
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    clientAuthentication: 'post',
    tokenJson: false,
    profileEndpoint: 'https://api.github.com/user',
    defaultScopes: ['read:user', 'repo'],
    allowedScopes: ['read:user', 'repo', 'public_repo', 'read:org', 'workflow', 'offline_access'],
  },
  {
    serviceId: 'google',
    name: 'Google Workspace',
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientAuthentication: 'post',
    tokenJson: false,
    profileEndpoint: 'https://www.googleapis.com/oauth2/v3/userinfo',
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
    issuer: 'https://vercel.com',
    authorizationEndpoint: 'https://vercel.com/oauth/authorize',
    tokenEndpoint: 'https://api.vercel.com/login/oauth/token',
    clientAuthentication: 'basic',
    tokenJson: false,
    profileEndpoint: 'https://api.vercel.com/v2/user',
    defaultScopes: ['offline_access'],
    allowedScopes: ['offline_access', 'openid', 'profile', 'email'],
  },
  {
    serviceId: 'notion',
    name: 'Notion',
    issuer: 'https://api.notion.com',
    authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
    clientAuthentication: 'basic',
    tokenJson: true,
    profileEndpoint: 'https://api.notion.com/v1/users/me',
    defaultScopes: [],
    allowedScopes: [],
  },
  {
    serviceId: 'supabase',
    name: 'Supabase',
    issuer: 'https://api.supabase.com',
    authorizationEndpoint: 'https://api.supabase.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.supabase.com/v1/oauth/token',
    clientAuthentication: 'basic',
    tokenJson: false,
    profileEndpoint: 'https://api.supabase.com/v1/profile',
    defaultScopes: [],
    allowedScopes: [],
  },
];

/** Official MCP targets and App labels come from the same bundled declarations as plugin installation. */
export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = providers.map((provider) => {
  const apps = loadBuiltinPluginApps(provider.serviceId);
  return {
    ...provider,
    mcpEndpoints: apps.map((app) => app.endpoint),
    apps: apps.map((app) => app.name),
  };
});

export function connectionProvider(id: ConnectionServiceId): ConnectionProvider {
  const provider = CONNECTION_PROVIDERS.find((item) => item.serviceId === id);
  if (provider === undefined) throw new Error('Unknown connection provider');
  return provider;
}
