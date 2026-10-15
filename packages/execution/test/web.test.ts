import { describe, expect, it } from 'vitest';
import { assertPublicAddress, parseWebUrl } from '../src/web.js';
import { executeTool } from '../src/index.js';

describe('public web targets', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.31.0.2',
    '192.168.1.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:0808:0808::',
    '2001:db8::1',
    '3fff::1',
  ])('refuses reserved address %s', (address) => {
    expect(() => assertPublicAddress(address)).toThrow('cannot access');
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'permits public address %s',
    (address) => {
      expect(() => assertPublicAddress(address)).not.toThrow();
    },
  );
  it.each([
    'file:///etc/passwd',
    'https://user:secret@example.com',
    'http://example.com:4311',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://[::1]',
    'http://localhost',
    'http://service.internal',
  ])('refuses unsafe URL %s', (url) => {
    expect(() => parseWebUrl(url)).toThrow();
  });
  it('rejects a real local HTTP destination before opening a request', async () => {
    await expect(
      executeTool(
        'web_fetch',
        { url: 'http://127.0.0.1/' },
        {
          workspaceRoot: '/unused',
          profileDirectory: '/unused',
          readOnly: false,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ code: 'PRIVATE_NETWORK' });
  });
});
