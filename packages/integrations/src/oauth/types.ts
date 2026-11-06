/** Deployment-owned client settings; secrets never belong to an authorization URL. */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  callbackUrl: string;
}

/** Optional account fields are display metadata and do not establish application identity. */
export interface OAuthAccount {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Declarative profile extraction shared by service account adapters. */
export interface OAuthProfile {
  source: 'userinfo' | 'id-token' | 'token';
  path?: string;
  method?: 'GET' | 'POST';
  idField: string;
  usernameField: string;
  displayNameField?: string;
  avatarUrlField?: string;
}

/** Fixed provider endpoints and authorization behavior, independent of installation state. */
export interface OAuthDefinition {
  id: string;
  apiUrl: string;
  oauth: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    pkce: boolean;
    tokenAuth: 'body' | 'basic';
    tokenFormat: 'form' | 'json';
    scopes: readonly string[];
    authorizationParams?: Readonly<Record<string, string>>;
    profile?: OAuthProfile;
    responsePolicy?: {
      /** Some fixed service adapters omit the redundant bearer type; supplied values remain checked. */
      allowMissingTokenType?: boolean;
      /** Account display metadata is not an OpenID Connect identity assertion. */
      displayOnlyIdToken?: boolean;
    };
  };
}
