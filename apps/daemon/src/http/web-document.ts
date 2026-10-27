import { randomBytes } from 'node:crypto';

/**
 * Prepare a trusted built entry for per-response style nonces without authorizing inline scripts.
 * @param template The application's built HTML, including its restrictive CSP meta element.
 * @returns A renderer that creates a fresh nonce shared by the CSP and the frontend style adapters.
 */
export function createWebDocumentRenderer(template: string): () => string {
  const policyMeta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/.exec(
    template,
  );
  const originalMeta = policyMeta?.[0];
  const originalPolicy = policyMeta?.[1];
  if (!originalMeta || !originalPolicy || !template.includes('<head>')) {
    throw new Error('The renderer entry must declare its Content Security Policy in head');
  }
  const directives = originalPolicy.split(';').map((directive) => directive.trim());
  if (directives.filter((directive) => directive.startsWith('style-src ')).length !== 1) {
    throw new Error('The renderer entry must declare one style-src directive');
  }
  if (!directives.includes("style-src 'self'") || !directives.includes("script-src 'self'")) {
    throw new Error('The renderer entry must restrict scripts and styles to self');
  }
  if (template.includes('property="csp-nonce"')) {
    throw new Error('The renderer entry cannot contain a preconfigured production nonce');
  }

  return (): string => {
    const nonce = randomBytes(32).toString('base64');
    const policy = directives
      .map((directive) => {
        if (directive === "style-src 'self'") return `${directive} 'nonce-${nonce}'`;
        return directive;
      })
      .join('; ');
    const meta = originalMeta.replace(originalPolicy, policy);
    return template
      .replace(originalMeta, meta)
      .replace('<head>', `<head>\n    <meta property="csp-nonce" nonce="${nonce}">`);
  };
}
