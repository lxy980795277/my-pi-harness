import type { AppUser } from '@my-pi-harness/protocol';

/** A provider adapter's verified stable subject; no upstream access token is retained. */
export interface VerifiedIdentity {
  providerId: string;
  issuer: string;
  subject: string;
  name: string;
  avatarUrl: string | null;
}

/** Durable local trust; tokenHash is the lowercase SHA-256 digest of the bearer token. */
export interface LocalClient {
  id: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

/** The login orchestrator owns token creation and computes its absolute expiry. */
export interface LoginSessionInput {
  id: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
}

/** Application login metadata with the profile owner's public user projection. */
export interface StoredLoginSession {
  id: string;
  clientId: string;
  user: AppUser;
  providerId: string;
  createdAt: number;
  expiresAt: number;
}
