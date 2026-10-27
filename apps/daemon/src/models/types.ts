import type { NativeProviderInfo } from '@my-pi-harness/protocol';

export interface ProviderAuthInput {
  kind: NativeProviderInfo['authKinds'][number];
}
