import { parseExternalUrl } from '@my-pi-harness/protocol';

/** Open a validated link after an explicit user action without navigating the application. */
export const openExternal = async (value: string): Promise<void> => {
  const url = parseExternalUrl(value);
  if (window.desktop) {
    await window.desktop.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};
