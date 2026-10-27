import { parseExternalUrl, type ConnectionServiceId } from '@my-pi-harness/protocol';

export interface ConnectionAuthorizationWindow {
  redirect: (value: string) => void;
  close: () => void;
}

/** Call before the first await so the browser can attribute this popup to the user's click. */
export const openConnectionAuthorizationWindow = (
  serviceId: ConnectionServiceId,
): ConnectionAuthorizationWindow | null => {
  if (window.desktop) return null;
  const local = new URL('/connection-oauth/launch', window.location.origin);
  local.searchParams.set('service', serviceId);
  const popup = window.open(local.href, '_blank', 'popup,width=720,height=760');
  if (popup === null) throw new Error('浏览器阻止了授权窗口，请允许弹窗后重试。');
  try {
    // Setting opener after opening preserves the parent's handle and prevents reverse navigation.
    popup.opener = null;
  } catch (error: unknown) {
    popup.close();
    throw error;
  }
  return {
    redirect(value): void {
      const url = parseExternalUrl(value);
      if (popup.closed) throw new Error('授权窗口已关闭，请重新打开授权页继续。');
      popup.location.replace(url);
    },
    close(): void {
      if (!popup.closed) popup.close();
    },
  };
};
