import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { McpToolCatalog, RemoteMcpView, SkillConnectionStatus } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { PluginAppConnection } from '@/features/plugins/components/plugin-app-connection';

const SERVER: RemoteMcpView = {
  id: 'synthetic-app',
  name: 'Synthetic App',
  revision: 3,
  accessEpoch: 4,
  endpoint: 'https://example.com/mcp',
  transport: 'streamable-http',
  publicHeaders: {},
  secretHeaders: [],
  oauth: false,
  oauthConnected: false,
  catalogStatus: 'idle',
  trusted: true,
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
};
const STATUS: SkillConnectionStatus = {
  collectionId: 'github',
  isConnected: true,
  account: { id: '123', username: 'synthetic', displayName: 'Synthetic User', avatarUrl: null },
};
const CATALOG: McpToolCatalog = {
  serverId: SERVER.id,
  serverRevision: SERVER.revision,
  scope: 'sandboxed',
  discoveredAt: 3,
  tools: [
    {
      serverId: SERVER.id,
      serverRevision: SERVER.revision,
      remoteToolName: 'synthetic_read',
      name: 'synthetic_read',
      description: 'Synthetic read tool',
      definitionFingerprint: 'a'.repeat(64),
      available: true,
      enabled: true,
      diagnostic: null,
    },
  ],
};

const render = (
  server: RemoteMcpView,
  usesPluginOAuth: boolean,
  authorization: SkillConnectionStatus = STATUS,
  prepare?: (client: QueryClient) => void,
): string => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['skill-connections', 'github'], authorization);
  client.setQueryData(
    ['mcp', 'plugin-app-tools', server.id, server.revision, server.accessEpoch],
    null,
  );
  if (prepare !== undefined) prepare(client);
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PluginAppConnection, {
          server,
          pluginId: 'github',
          usesPluginOAuth,
          disabled: false,
        }),
      ),
    );
  } finally {
    client.clear();
  }
};

const buttonMarkup = (html: string, text: string): string => {
  const buttons = html.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
  const button = buttons.find((entry) => {
    return entry.endsWith(`>${text}</button>`);
  });
  if (button === undefined) throw new Error(`Missing button: ${text}`);
  return button;
};

describe('plugin App details', () => {
  it('reuses the plugin credential without account binding or another OAuth control', () => {
    const html = render(SERVER, true);
    expect(html).toContain('正在使用插件授权，无需单独连接。');
    expect(buttonMarkup(html, '刷新工具')).not.toContain('disabled=""');
    for (const text of [
      '关联账户',
      '信任并启用',
      '重新确认服务信任',
      '取消应用授权',
      '重新打开授权页面',
      '>授权</button>',
    ])
      expect(html).not.toContain(text);
  });

  it('hides old tools and disables refresh after the plugin credential is disconnected', () => {
    const withCatalog = (client: QueryClient): void => {
      client.setQueryData(
        ['mcp', 'plugin-app-tools', SERVER.id, SERVER.revision, SERVER.accessEpoch],
        CATALOG,
      );
    };
    expect(render(SERVER, true, STATUS, withCatalog)).toContain('synthetic_read');
    const html = render(
      SERVER,
      true,
      { ...STATUS, isConnected: false, account: null },
      withCatalog,
    );
    expect(html).toContain('插件未授权或授权已失效');
    expect(html).not.toContain('synthetic_read');
    expect(buttonMarkup(html, '刷新工具')).toContain('disabled=""');
  });

  it('does not reuse a catalog from a previous server access epoch', () => {
    const html = render(
      { ...SERVER, accessEpoch: SERVER.accessEpoch + 1 },
      true,
      STATUS,
      (client): void => {
        client.setQueryData(
          ['mcp', 'plugin-app-tools', SERVER.id, SERVER.revision, SERVER.accessEpoch],
          CATALOG,
        );
      },
    );
    expect(html).not.toContain('synthetic_read');
  });

  it('keeps an independent MCP OAuth action separate from the plugin credential', () => {
    const html = render({ ...SERVER, oauth: true }, false);
    expect(html).toContain('需要完成 OAuth 授权后才能使用。');
    expect(buttonMarkup(html, '授权')).not.toContain('disabled=""');
    expect(buttonMarkup(html, '刷新工具')).toContain('disabled=""');
    const connected = render({ ...SERVER, oauth: true, oauthConnected: true }, false);
    expect(connected).toContain('OAuth 已授权');
    expect(connected).toContain('>重新授权</button>');
  });

  it('does not expose authorization actions for an unopened App', () => {
    const html = render({ ...SERVER, enabled: false, oauth: true }, false);
    expect(html).not.toContain('>授权</button>');
    expect(buttonMarkup(html, '刷新工具')).toContain('disabled=""');
  });
  it('shows a tool discovery failure without claiming that the plugin authorization failed', () => {
    const html = render(
      {
        ...SERVER,
        catalogStatus: 'error',
        catalogError: { code: 'MCP_PROTOCOL', message: 'MCP 工具目录获取失败，请重试。' },
      },
      true,
    );
    expect(html).toContain('MCP 工具目录获取失败，请重试。');
    expect(html).toContain('正在使用插件授权，无需单独连接。');
    expect(buttonMarkup(html, '刷新工具')).not.toContain('disabled=""');
  });
});
