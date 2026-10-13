import { API_PREFIX } from '@/constants/api.js';

/** Subscribes to one same-origin event type and returns its complete connection cleanup. */
export const subscribeSse = (
  path: string,
  eventType: string,
  onMessage: (event: Event) => void,
  onDisconnect: () => void,
): (() => void) => {
  const source = new EventSource(`${API_PREFIX}${path}`);
  source.addEventListener(eventType, onMessage);
  source.onerror = onDisconnect;

  return (): void => {
    source.removeEventListener(eventType, onMessage);
    source.onerror = null;
    source.close();
  };
};
