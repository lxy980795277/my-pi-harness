import type { PluginOAuthCredential } from '@my-pi-harness/protocol/internal';

/** The host owns private storage and guards every publication against revoked authorization. */
export interface PluginCredentialPort {
  read(id: string): PluginOAuthCredential | undefined;
  set(id: string, credential: PluginOAuthCredential, assertCurrent?: () => void): Promise<void>;
  delete(id: string, assertCurrent?: () => void): Promise<void>;
  close(): Promise<void>;
}
