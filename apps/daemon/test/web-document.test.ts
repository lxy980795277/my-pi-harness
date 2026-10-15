import { describe, expect, it } from 'vitest';
import { createWebDocumentRenderer } from '../src/web-document.js';

const entry =
  "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'\"></head><body><div id=\"root\"></div></body></html>";

describe('built renderer CSP', () => {
  it('authorizes dependency style tags with a fresh document nonce while retaining script restrictions', () => {
    const render = createWebDocumentRenderer(entry);
    const first = render();
    const second = render();
    const nonce = /property="csp-nonce" nonce="([A-Za-z0-9+/=]+)"/.exec(first)?.[1];
    expect(nonce).toBeDefined();
    expect(first).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(first).toContain("script-src 'self';");
    expect(first).toContain("object-src 'none'");
    expect(first).not.toContain('unsafe-inline');
    expect(second).not.toContain(`nonce="${nonce}"`);
  });

  it.each([
    '<html><head></head></html>',
    entry.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
    entry.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    entry.replace("style-src 'self'", "style-src 'self'; style-src 'none'"),
    entry.replace('<head>', '<head><meta property="csp-nonce" nonce="fixed">'),
  ])('refuses a missing or broadened policy before serving the renderer', (invalid) => {
    expect(() => createWebDocumentRenderer(invalid)).toThrow();
  });
});
