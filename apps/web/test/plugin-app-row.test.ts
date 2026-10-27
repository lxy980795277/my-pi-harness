import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RemoteMcpView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { PluginAppRow } from '@/features/plugins/components/plugin-app-row';

const SERVER: RemoteMcpView = {
  id: 'synthetic-app',
  name: 'Custom App',
  revision: 1,
  accessEpoch: 1,
  endpoint: 'https://example.test/mcp',
  transport: 'streamable-http',
  publicHeaders: {},
  secretHeaders: [],
  oauth: true,
  oauthConnected: false,
  catalogStatus: 'idle',
  trusted: true,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

const render = (pluginId: string, usesPluginOAuth: boolean): string => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PluginAppRow, {
          pluginId,
          installed: true,
          app: {
            id: 'custom-app',
            name: 'Custom App',
            description: 'Custom integration',
            enabled: true,
            disabled: false,
            status: '已授权',
            server: SERVER,
            usesPluginOAuth,
            open: (): void => undefined,
            change: (): void => undefined,
          },
        }),
      ),
    );
  } finally {
    client.clear();
  }
};

describe('declarative App authorization sources', () => {
  it('reuses a plugin credential for any plugin identifier without another App authorization action', () => {
    const html = render('custom-provider', true);
    expect(html).not.toContain('aria-label="授权 Custom App"');
    expect(html).toContain('>已授权</button>');
    expect(html).toContain('aria-label="查看 Custom App 应用详情"');
  });

  it('uses independent MCP authorization even for a provider formerly hardcoded as shared', () => {
    const html = render('github', false);
    expect(html).toContain('aria-label="授权 Custom App"');
    expect(html).toContain('>授权</button>');
  });
});
