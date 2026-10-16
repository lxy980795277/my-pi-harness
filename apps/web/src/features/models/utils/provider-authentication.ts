import type { NativeProviderInfo, ProviderConfig } from '@my-pi-harness/protocol';

import type { AuthenticationMethod, ProviderAuthentication } from '@/features/models/types/model';

/** A native provider exposes only the authentication kinds declared by Pi. */
export const getProviderAuthentication = (
  provider: ProviderConfig | null,
  native: NativeProviderInfo | undefined,
): ProviderAuthentication => {
  const custom = provider === null || provider.kind === 'custom';
  const supportsApiKey = custom || native?.authKinds.includes('api_key') === true;
  const supportsOAuth = !custom && native?.authKinds.includes('oauth') === true;
  let initialMethod: AuthenticationMethod = 'api_key';
  if (supportsOAuth && (!supportsApiKey || provider?.credentialType === 'oauth')) {
    initialMethod = 'oauth';
  }
  return { supportsApiKey, supportsOAuth, initialMethod };
};
