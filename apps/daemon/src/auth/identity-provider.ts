import type { VerifiedIdentity } from '@my-pi-harness/storage';
import type { LoginMethod } from '@my-pi-harness/protocol';

/** A public challenge and its private, cancellable identity verification operation. */
export interface IdentityChallenge {
  url: string;
  userCode: string | null;
  expiresAt: number;
  verify(signal: AbortSignal): Promise<VerifiedIdentity>;
}

/** The verifier and token exchange remain inside the host-owned challenge. */
export interface WebIdentityChallenge {
  url: string;
  /** Expected OAuth authorization-response issuer, independent of persisted identity issuer. */
  authorizationIssuer: string;
  expiresAt: number;
  complete(code: string, signal: AbortSignal): Promise<VerifiedIdentity>;
}

/** Login sources return verified identities; application sessions are issued separately. */
export interface IdentityProvider {
  id: string;
  name: string;
  available: boolean;
  methods: readonly LoginMethod[];
  begin?(signal: AbortSignal): Promise<IdentityChallenge>;
  beginWeb?(
    callbackUrl: string,
    state: string,
    signal: AbortSignal,
  ): WebIdentityChallenge | Promise<WebIdentityChallenge>;
}
