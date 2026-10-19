import { API_PREFIX } from '@/constants/api';
import { requestAuthorizationCheck } from '@/services/base-request';

/** Subscribes to one same-origin event type and returns its complete connection cleanup. */
export const subscribeSse = (
  path: string,
  eventType: string,
  onMessage: (event: Event) => void,
  onDisconnect: () => void,
  onOpen?: () => void,
): (() => void) => {
  const source = new EventSource(`${API_PREFIX}${path}`);
  source.addEventListener(eventType, onMessage);
  source.onerror = (): void => {
    requestAuthorizationCheck();
    onDisconnect();
  };
  if (onOpen) {
    source.onopen = onOpen;
  }

  return (): void => {
    source.removeEventListener(eventType, onMessage);
    source.onerror = null;
    source.onopen = null;
    source.close();
  };
};
