import type { RuntimeReadyEvent } from '@my-pi-harness/protocol';

/** Notifications delivered after runtime event validation or connection failure. */
export interface RuntimeSubscription {
  onReady: (event: RuntimeReadyEvent) => void;
  onError: (message: string) => void;
}
