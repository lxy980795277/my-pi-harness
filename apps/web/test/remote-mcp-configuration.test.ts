import { describe, expect, it } from 'vitest';
import type { RemoteMcpView } from '@my-pi-harness/protocol';
import {
  clearRemoteMcpDraftSecrets,
  createRemoteMcpDraft,
  encodeRemoteMcpDraft,
  parseRemoteMcpDraft,
  prepareRemoteMcpDraft,
} from '../src/features/mcp/utils/remote-mcp-configuration';

const endpoint = 'https://example.com/mcp';
const savedServer = (overrides: Partial<RemoteMcpView> = {}): RemoteMcpView => {
  return {
    id: 'host-owned-uuid',
    name: 'workspace-tools',
    transport: 'streamable-http',
    endpoint,
    publicHeaders: { 'X-Workspace': 'demo' },
    secretHeaders: [{ slotId: 'saved-token', headerName: 'Authorization', configured: true }],
    oauth: false,
    revision: 3,
    accessEpoch: 4,
    enabled: false,
    trusted: false,
    oauthConnected: false,
    catalogStatus: 'idle',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
};

describe('remote MCP form and JSON configuration', () => {
  it('round-trips an incomplete new draft without allowing it to be saved', () => {
    const initial = createRemoteMcpDraft(null);
    const restored = parseRemoteMcpDraft(encodeRemoteMcpDraft(initial));
    expect(restored).toEqual(initial);
    expect(() => {
      prepareRemoteMcpDraft(restored, null);
    }).toThrow('MCP 配置字段无效');
    expect(() => {
      prepareRemoteMcpDraft({ ...restored, mcpId: 'workspace-tools' }, null);
    }).toThrow('MCP 配置字段无效');
    expect(() => {
      prepareRemoteMcpDraft({ ...restored, endpoint }, null);
    }).toThrow('MCP 配置字段无效');
  });

  it('normalizes HTTP aliases and SSE while keeping the user MCP ID separate from host identity', () => {
    const defaultDraft = parseRemoteMcpDraft(
      JSON.stringify({ mcpServers: { 'workspace-tools': { url: endpoint } } }),
    );
    expect(defaultDraft).toMatchObject({
      mcpId: 'workspace-tools',
      transport: 'streamable-http',
      endpoint,
      oauth: false,
      headers: [],
    });
    for (const [type, expected] of [
      ['http', 'streamable-http'],
      ['streamable-http', 'streamable-http'],
      ['sse', 'sse'],
    ]) {
      const draft = parseRemoteMcpDraft(
        JSON.stringify({ mcpServers: { 'workspace-tools': { url: endpoint, type } } }),
      );
      expect(draft.transport).toBe(expected);
      expect(parseRemoteMcpDraft(encodeRemoteMcpDraft(draft)).transport).toBe(expected);
    }
    const prepared = prepareRemoteMcpDraft(defaultDraft, null);
    expect(prepared.input.name).toBe('workspace-tools');
    expect(prepared.input).not.toHaveProperty('id');
  });

  it('round-trips OAuth client and shared-account fields without changing authentication mode', () => {
    const oauthClient = {
      clientId: 'synthetic-public-client',
      issuer: 'https://example.com/oauth',
      scopes: ['documents.read'],
      clientSecret: true,
      accessTypeOffline: true,
    };
    const oauth = savedServer({ oauth: true, oauthClient, secretHeaders: [] });
    const oauthDraft = parseRemoteMcpDraft(encodeRemoteMcpDraft(createRemoteMcpDraft(oauth)));
    expect(prepareRemoteMcpDraft(oauthDraft, oauth).input).toMatchObject({
      oauth: true,
      oauthClient,
    });
    const connected = savedServer({ connectionId: 'account-id', secretHeaders: [] });
    const connectedDraft = parseRemoteMcpDraft(
      encodeRemoteMcpDraft(createRemoteMcpDraft(connected)),
    );
    expect(prepareRemoteMcpDraft(connectedDraft, connected).input).toMatchObject({
      oauth: false,
      connectionId: 'account-id',
    });
  });

  it('separates pasted credentials from public configuration and retains explicitly public headers', () => {
    const draft = parseRemoteMcpDraft(
      JSON.stringify({
        mcpServers: {
          'workspace-tools': {
            url: endpoint,
            headers: { Authorization: 'Bearer synthetic-private-value' },
            publicHeaders: { 'X-Workspace': 'demo' },
          },
        },
      }),
    );
    const prepared = prepareRemoteMcpDraft(draft, null);
    expect(prepared.input.publicHeaders).toEqual({ 'X-Workspace': 'demo' });
    expect(prepared.input.secretHeaders).toHaveLength(1);
    expect(prepared.secrets).toEqual([
      {
        slotId: prepared.input.secretHeaders[0]?.slotId,
        value: 'Bearer synthetic-private-value',
      },
    ]);
    expect(JSON.stringify(prepared.input)).not.toContain('synthetic-private-value');
    expect(
      draft.headers.find((header) => {
        return header.name === 'Authorization';
      }),
    ).toMatchObject({ kind: 'secret', configured: false });
  });

  it('preserves only real configured slots belonging to the original server', () => {
    const original = savedServer();
    const draft = parseRemoteMcpDraft(encodeRemoteMcpDraft(createRemoteMcpDraft(original)));
    const prepared = prepareRemoteMcpDraft(draft, original);
    expect(prepared.secrets).toEqual([]);
    expect(prepared.input.secretHeaders).toEqual([
      { slotId: 'saved-token', headerName: 'Authorization' },
    ]);
    const forged = parseRemoteMcpDraft(
      JSON.stringify({
        mcpServers: {
          'workspace-tools': {
            url: endpoint,
            secretHeaders: [{ slotId: 'unrelated-token', headerName: 'Authorization' }],
          },
        },
      }),
    );
    expect(() => {
      prepareRemoteMcpDraft(forged, original);
    }).toThrow('请填写秘密 Header');
    expect(() => {
      prepareRemoteMcpDraft(draft, null);
    }).toThrow('请填写秘密 Header');
    expect(() => {
      prepareRemoteMcpDraft(
        draft,
        savedServer({
          secretHeaders: [
            { slotId: 'saved-token', headerName: 'Authorization', configured: false },
          ],
        }),
      );
    }).toThrow('请填写秘密 Header');
  });

  it('requires replacement credentials after endpoint or transport changes', () => {
    const original = savedServer();
    const initial = createRemoteMcpDraft(original);
    for (const changed of [
      { ...initial, endpoint: 'https://other.example.com/mcp' },
      { ...initial, transport: 'sse' as const },
    ]) {
      expect(() => {
        prepareRemoteMcpDraft(changed, original);
      }).toThrow('请重新填写秘密 Header');
      const replaced = {
        ...changed,
        headers: changed.headers.map((header) => {
          if (header.kind === 'secret') return { ...header, value: 'Bearer replacement-value' };
          return header;
        }),
      };
      expect(prepareRemoteMcpDraft(replaced, original).secrets).toEqual([
        { slotId: 'saved-token', value: 'Bearer replacement-value' },
      ]);
    }
  });

  it('rejects unsupported fields, multiple entries, stdio, duplicate headers and control characters', () => {
    const invalid: unknown[] = [
      { mcpServers: { first: { url: endpoint }, second: { url: endpoint } } },
      { mcpServers: {} },
      { mcpServers: { first: { url: endpoint, type: 'stdio' } } },
      { mcpServers: { first: { url: endpoint, command: '/bin/program' } } },
      { mcpServers: { first: { url: endpoint, unknown: true } } },
      { mcpServers: { first: { url: endpoint } }, unknown: true },
      {
        mcpServers: {
          first: { url: endpoint, headers: { Authorization: 'a', authorization: 'b' } },
        },
      },
      {
        mcpServers: {
          first: {
            url: endpoint,
            headers: { 'X-Custom': 'a' },
            publicHeaders: { 'x-custom': 'b' },
          },
        },
      },
      {
        mcpServers: {
          first: { url: endpoint, headers: { Authorization: 'Bearer value\r\nX-Other: injected' } },
        },
      },
      { mcpServers: { first: { url: endpoint, publicHeaders: { 'X-Custom': 'value\0' } } } },
    ];
    for (const document of invalid) {
      expect(() => {
        parseRemoteMcpDraft(JSON.stringify(document));
      }).toThrow();
    }
    expect(() => {
      parseRemoteMcpDraft('{"mcpServers":{"synthetic-private-value":');
    }).toThrow('MCP JSON 无法解析，请检查语法。');
  });

  it('clears replacement secrets without falling back to stored credentials and retains unchanged saved slots', () => {
    const original = savedServer();
    const initial = createRemoteMcpDraft(original);
    const unchanged = clearRemoteMcpDraftSecrets(initial);
    expect(prepareRemoteMcpDraft(unchanged, original).secrets).toEqual([]);
    expect(unchanged.headers[1]).toMatchObject({ configured: true, value: '' });
    const draft = {
      ...initial,
      headers: initial.headers.map((header) => {
        if (header.kind === 'secret') return { ...header, value: 'Bearer unsaved-value' };
        return header;
      }),
    };
    const cleared = clearRemoteMcpDraftSecrets(draft);
    expect(cleared.headers).toEqual([
      { ...draft.headers[0], value: 'demo' },
      { ...draft.headers[1], value: '', configured: false },
    ]);
    expect(() => {
      prepareRemoteMcpDraft(cleared, original);
    }).toThrow('请填写秘密 Header');
    const refilled = {
      ...cleared,
      headers: cleared.headers.map((header) => {
        if (header.kind === 'secret') return { ...header, value: 'Bearer confirmed-new-value' };
        return header;
      }),
    };
    expect(prepareRemoteMcpDraft(refilled, original).secrets).toEqual([
      { slotId: 'saved-token', value: 'Bearer confirmed-new-value' },
    ]);
    expect(draft.headers[1]?.value).toBe('Bearer unsaved-value');
  });
});
