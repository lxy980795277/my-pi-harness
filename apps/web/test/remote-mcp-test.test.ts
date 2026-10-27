import { describe, expect, it } from 'vitest';
import type { RemoteMcpView } from '@my-pi-harness/protocol';
import { createRemoteMcpDraft } from '@/features/mcp/utils/remote-mcp-configuration';
import { prepareRemoteMcpTest } from '@/features/mcp/utils/remote-mcp-test';

const server: RemoteMcpView = {
  id: 'saved-server',
  name: 'docs',
  revision: 1,
  accessEpoch: 1,
  transport: 'streamable-http',
  endpoint: 'https://example.com/mcp',
  publicHeaders: {},
  secretHeaders: [
    { slotId: 'first', headerName: 'Authorization', configured: true },
    { slotId: 'second', headerName: 'X-API-Key', configured: true },
  ],
  oauth: false,
  oauthConnected: false,
  catalogStatus: 'idle',
  enabled: true,
  trusted: true,
  createdAt: 1,
  updatedAt: 1,
};

describe('remote MCP connection test selection', () => {
  it('uses the authorized saved configuration only for unchanged credentials and settings', () => {
    expect(prepareRemoteMcpTest(createRemoteMcpDraft(server), server)).toEqual({
      kind: 'saved',
      server,
    });
    const renamed = { ...createRemoteMcpDraft(server), mcpId: 'renamed' };
    expect(prepareRemoteMcpTest(renamed, server).kind).toBe('saved');
  });

  it('rejects mixing a replacement token with retained credentials instead of testing the old token', () => {
    const draft = createRemoteMcpDraft(server);
    const first = draft.headers[0];
    if (first === undefined) throw new Error('Missing test fixture header');
    first.value = 'Bearer replacement';
    expect(() => {
      prepareRemoteMcpTest(draft, server);
    }).toThrow('全部请求头值');
  });

  it('tests the complete replacement header set as a draft without borrowing old credentials', () => {
    const draft = createRemoteMcpDraft(server);
    for (const header of draft.headers) header.value = `replacement-${header.slotId}`;
    const plan = prepareRemoteMcpTest(draft, server);
    expect(plan).toEqual({
      kind: 'draft',
      clearsSecrets: true,
      input: {
        transport: 'streamable-http',
        endpoint: server.endpoint,
        headers: { Authorization: 'replacement-first', 'X-API-Key': 'replacement-second' },
      },
    });
  });

  it('rejects a modified public header or disabled saved configuration when credentials are retained', () => {
    const draft = createRemoteMcpDraft(server);
    draft.headers.push({
      id: 'public',
      name: 'X-Version',
      value: 'new',
      slotId: '',
      configured: false,
      kind: 'public',
    });
    expect(() => {
      prepareRemoteMcpTest(draft, server);
    }).toThrow('配置已修改');
    expect(() => {
      prepareRemoteMcpTest(createRemoteMcpDraft(server), { ...server, enabled: false });
    }).toThrow('信任此服务');
  });
});
