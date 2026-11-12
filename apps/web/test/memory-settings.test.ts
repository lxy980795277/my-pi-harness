import type { MemorySettings } from '@my-pi-harness/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNonce, setNonce } from 'get-nonce';
import { useNavigationStore } from '../src/app/stores/navigation';
import { useMemoryPanel } from '../src/features/memory/hooks/use-memory-panel';
import type { MemoryPanelState, MemorySettingKey } from '../src/features/memory/types/memory';
import { MemorySettingsPanel } from '../src/features/memory/components/memory-settings';

afterEach(() => {
  vi.unstubAllGlobals();
  useNavigationStore.getState().reset();
});

describe('memory use and automatic learning settings', () => {
  it.each([
    {
      key: 'allowLearning',
      value: false,
      original: { allowUse: true, allowLearning: true, revision: 1 },
      expected: { allowUse: true, allowLearning: false },
    },
    {
      key: 'allowUse',
      value: false,
      original: { allowUse: true, allowLearning: true, revision: 1 },
      expected: { allowUse: false, allowLearning: true },
    },
    {
      key: 'allowUse',
      value: true,
      original: { allowUse: false, allowLearning: false, revision: 1 },
      expected: { allowUse: true, allowLearning: false },
    },
  ] satisfies {
    key: MemorySettingKey;
    value: boolean;
    original: MemorySettings;
    expected: Pick<MemorySettings, 'allowUse' | 'allowLearning'>;
  }[])(
    'changing $key retains the other permission and its observed revision',
    async ({ key, value, original, expected }) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(JSON.stringify({ ...expected, revision: 2 }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetch);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(['memory-settings'], original);
      client.setQueryData(['workspaces'], []);
      let state: MemoryPanelState | undefined;
      const Probe: FC = () => {
        state = useMemoryPanel();
        return null;
      };
      renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
      if (state === undefined) throw new Error('Panel did not render');
      const panel = state;
      try {
        panel.updateSettings.run(key, value);
        await vi.waitFor(() =>
          expect(client.getQueryData(['memory-settings'])).toEqual({ ...expected, revision: 2 }),
        );
        const serialized = fetch.mock.calls[0]?.[1]?.body;
        if (typeof serialized !== 'string')
          throw new Error('Settings body was not serialized JSON');
        const body: unknown = JSON.parse(serialized);
        expect(body).toMatchObject({ ...expected, expectedRevision: 1 });
        expect(fetch).toHaveBeenCalledWith(
          '/api/memory-settings',
          expect.objectContaining({ method: 'PUT' }),
        );
        expect(fetch).toHaveBeenCalledOnce();
      } finally {
        panel.updateSettings.cancel();
        panel.refresh.cancel();
        client.clear();
      }
    },
  );

  it.each([true, false])(
    'shows the server learning preference and its availability when use is %s',
    (allowUse) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(['memory-settings'], { allowUse, allowLearning: true, revision: 0 });
      client.setQueryData(['workspaces'], []);
      client.setQueryData(['memories', 'user', 'all', null], {
        items: [],
        nextCursor: null,
        total: 0,
      });
      const nonce = getNonce() ?? '';
      setNonce('memory-settings-test');
      try {
        const html = renderToStaticMarkup(
          createElement(QueryClientProvider, { client }, createElement(MemorySettingsPanel)),
        );
        const control = html.match(/<button(?=[^>]*id="memory-allow-learning")[^>]*>/)?.[0];
        expect(control).toBeDefined();
        expect(control?.includes('disabled=""')).toBe(!allowUse);
        expect(control).toContain('aria-checked="true"');
        expect(html).toContain('使用记忆');
        expect(html).toContain('从对话中学习');
        expect(html).not.toContain('待确认建议');
      } finally {
        setNonce(nonce);
        client.clear();
      }
    },
  );
});
