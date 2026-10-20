import { parseExternalUrl } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';

describe('authored external links', () => {
  it('preserves encoded paths, query and fragment while normalizing the destination', () => {
    expect(parseExternalUrl('HTTPS://Example.com/a%20b?q=test#part')).toBe(
      'https://example.com/a%20b?q=test#part',
    );
    expect(parseExternalUrl('http://localhost:8080/guide')).toBe('http://localhost:8080/guide');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/private',
    '//example.com',
    '/relative',
    '#fragment',
    'https://user:password@example.com',
    'https://example.com/\n',
    'java\tscript:alert(1)',
    ' https://example.com',
    '',
    'https://example.com/' + 'a'.repeat(4096),
    'https://example.com/' + '文'.repeat(600),
    null,
    {},
    123,
  ])('rejects non-Web or malformed destinations: %s', (value) => {
    expect(() => parseExternalUrl(value)).toThrow();
  });
});
