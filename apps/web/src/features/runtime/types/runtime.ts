import type { HealthResponse, RuntimeReadyEvent } from '@my-pi-harness/protocol';

/** Notifications delivered after runtime event validation or connection failure. */
export interface RuntimeSubscription {
  onReady: (event: RuntimeReadyEvent) => void;
  onError: (message: string) => void;
}

export type RuntimeConnectionStatus = 'loading' | 'error' | 'ready';

export type EventConnection =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; event: RuntimeReadyEvent };

export interface RuntimeConnection {
  status: RuntimeConnectionStatus;
  message: string;
  health: HealthResponse | undefined;
  event: RuntimeReadyEvent | undefined;
  retry: () => void;
}
