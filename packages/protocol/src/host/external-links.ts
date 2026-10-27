/** Normalize explicit Web links; malformed, credentialed and non-HTTP(S) destinations throw. */
export const parseExternalUrl = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    throw new Error('链接地址无效');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Authored destinations must be absolute URLs, not filesystem or document-relative paths.
    throw new Error('链接地址无效');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.href.length > 4096
  ) {
    throw new Error('仅支持 HTTP 或 HTTPS 链接');
  }
  return url.href;
};
