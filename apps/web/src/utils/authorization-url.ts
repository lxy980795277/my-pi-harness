/** Allows provider-owned HTTPS and explicit loopback OAuth interaction URLs. */
export const authorizationUrl = (value: string): string => {
  const url = new URL(value);
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error('授权链接使用了不允许的地址。');
  }
  return url.href;
};
