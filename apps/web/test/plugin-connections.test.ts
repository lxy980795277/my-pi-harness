import { describe, expect, it } from 'vitest';
import type { RemoteMcpView, SkillConnectionStatus } from '@my-pi-harness/protocol';
import { pluginAppConnectionLabel } from '@/features/plugins/utils/plugin-connections';

const SERVER: RemoteMcpView = {
  id: 'synthetic-app',
  name: 'GitHub',
  transport: 'streamable-http',
  endpoint: 'https://example.com/mcp',
  publicHeaders: {},
  secretHeaders: [],
  oauth: false,
  oauthConnected: false,
  catalogStatus: 'idle',
  enabled: false,
  trusted: false,
  revision: 1,
  accessEpoch: 1,
  createdAt: 1,
  updatedAt: 1,
};
const STATUS: SkillConnectionStatus = {
  collectionId: 'github',
  isConnected: true,
  account: { id: '123', username: 'synthetic', displayName: 'Synthetic User', avatarUrl: null },
};

describe('plugin App authorization sources', () => {
  it('shows unopened Apps independently of plugin authorization', () => {
    expect(pluginAppConnectionLabel(SERVER, STATUS, true)).toBe('未开启');
  });
  it('uses the plugin credential status without a manually associated account identifier', () => {
    const enabled = { ...SERVER, enabled: true, trusted: true };
    expect(pluginAppConnectionLabel(enabled, null, true)).toBe('需要插件授权');
    expect(
      pluginAppConnectionLabel(enabled, { ...STATUS, isConnected: false, account: null }, true),
    ).toBe('需要插件授权');
    expect(pluginAppConnectionLabel(enabled, STATUS, true)).toBe('工具尚未就绪');
  });
  it('keeps independent MCP OAuth separate from the plugin token', () => {
    const enabled = { ...SERVER, enabled: true, trusted: true, oauth: true };
    expect(pluginAppConnectionLabel(enabled, STATUS, false)).toBe('未授权');
    expect(pluginAppConnectionLabel({ ...enabled, oauthConnected: true }, null, false)).toBe(
      '工具尚未就绪',
    );
  });
  it('distinguishes successful authorization from tool discovery progress and failure', () => {
    const enabled: RemoteMcpView = {
      ...SERVER,
      enabled: true,
      trusted: true,
      catalogStatus: 'loading',
    };
    expect(pluginAppConnectionLabel(enabled, STATUS, true)).toBe('正在发现工具');
    expect(pluginAppConnectionLabel({ ...enabled, catalogStatus: 'ready' }, STATUS, true)).toBe(
      '已连接',
    );
    expect(
      pluginAppConnectionLabel(
        {
          ...enabled,
          catalogStatus: 'error',
          catalogError: { code: 'MCP_PROTOCOL', message: '工具目录获取失败，请重试。' },
        },
        STATUS,
        true,
      ),
    ).toBe('工具发现失败');
    expect(
      pluginAppConnectionLabel(
        { ...enabled, catalogStatus: 'ready', trusted: false },
        STATUS,
        true,
      ),
    ).toBe('需要重新开启');
    expect(
      pluginAppConnectionLabel(
        { ...enabled, catalogStatus: 'ready', oauth: true, oauthConnected: false },
        STATUS,
        true,
      ),
    ).toBe('已连接');
  });
});
