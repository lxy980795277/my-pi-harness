import { describe, expect, it } from 'vitest';

import { authorizationUrl } from '../src/utils/authorization-url';

describe('browser OAuth interaction links', () => {
  it('accepts HTTPS authorization and explicit local callback interactions', () => {
    expect(authorizationUrl('https://github.com/login/oauth/authorize?state=challenge')).toContain(
      'https://github.com/',
    );
    expect(authorizationUrl('http://127.0.0.1:3456/callback')).toBe(
      'http://127.0.0.1:3456/callback',
    );
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///tmp/token',
    'http://remote.example/auth',
    'https://user:password@example.com/auth',
  ])('rejects unsafe interaction URL %s', (url) => {
    expect(() => {
      authorizationUrl(url);
    }).toThrow();
  });
});
