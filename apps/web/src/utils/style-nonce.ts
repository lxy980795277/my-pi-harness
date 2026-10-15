import { getNonce, setNonce } from 'get-nonce';

/** Initializes the host-provided CSP nonce before any Radix style singleton mounts. */
export const initializeStyleNonce = (): void => {
  const element = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]');
  const nonce = element?.nonce;
  if (!nonce) {
    throw new Error('页面缺少 CSP 样式授权，请通过本机服务或开发服务器打开应用。');
  }
  setNonce(nonce);
};

/** Returns the validated nonce shared by Radix viewports and react-style-singleton. */
export const getStyleNonce = (): string => {
  const nonce = getNonce();
  if (!nonce) {
    throw new Error('CSP 样式授权尚未初始化。');
  }
  return nonce;
};
