import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { parseRemoteUrl } from '@my-pi-harness/integrations';
import type { RemoteMcpInput } from '@my-pi-harness/protocol';
import type { StoredRemoteMcpServer } from '@my-pi-harness/storage';

const forbiddenHeaders = new Set([
  'host',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'connection',
  'content-length',
  'transfer-encoding',
  'mcp-session-id',
  'mcp-protocol-version',
]);

/** Header ownership and case-insensitive uniqueness apply to saved settings and one-off tests. */
export function validateRemoteHeader(name: string, value: string, names: Set<string>): void {
  const lower = name.toLowerCase();
  if (
    !/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(name) ||
    forbiddenHeaders.has(lower) ||
    names.has(lower) ||
    /[\r\n\0]/.test(value)
  )
    throw new RuntimeError('MCP_HEADER_INVALID', '请求头名称、值或重复项无效。');
  names.add(lower);
}

/** Public settings cannot contain authentication values or conflicting credential sources. */
export function validateRemoteInput(input: RemoteMcpInput, fixtureOrigin?: string): RemoteMcpInput {
  const endpoint = parseRemoteUrl(input.endpoint, fixtureOrigin).toString();
  const names = new Set<string>();
  for (const [name, value] of Object.entries(input.publicHeaders)) {
    validateRemoteHeader(name, value, names);
    if (/authorization|token|secret|api.?key/i.test(name))
      throw new RuntimeError('MCP_HEADER_INVALID', '认证信息请使用秘密请求头槽位。');
  }
  const slots = new Set<string>();
  for (const slot of input.secretHeaders) {
    if (slot.slotId === '__oauth_client_secret__' || slots.has(slot.slotId))
      throw new RuntimeError('MCP_HEADER_INVALID', '秘密请求头或槽位重复或受限。');
    validateRemoteHeader(slot.headerName, '', names);
    slots.add(slot.slotId);
  }
  if (input.oauthClient !== undefined) {
    parseRemoteUrl(input.oauthClient.issuer, fixtureOrigin);
    if (!input.oauth)
      throw new RuntimeError('MCP_OAUTH_DISABLED', '预注册OAuth客户端需要启用OAuth。');
  }
  if (input.connectionId !== undefined && (input.oauth || names.has('authorization')))
    throw new RuntimeError(
      'MCP_HEADER_INVALID',
      '服务连接、MCP OAuth与静态Authorization不能同时配置。',
    );
  if (input.oauth && names.has('authorization'))
    throw new RuntimeError('MCP_HEADER_INVALID', 'OAuth与静态Authorization不能同时配置。');
  const name = input.name.trim();
  if (name.length === 0) throw new RuntimeError('MCP_NAME_INVALID', 'MCP ID不能为空。');
  return { ...input, name, endpoint };
}

/** Alias comparison and the following synchronous save share the daemon's single profile owner. */
export function assertRemoteNameAvailable(
  servers: readonly StoredRemoteMcpServer[],
  name: string,
  ownId?: string,
): void {
  const key = name.trim().toLowerCase();
  if (servers.some((server) => server.id !== ownId && server.name.trim().toLowerCase() === key))
    throw new RuntimeError('MCP_NAME_CONFLICT', 'MCP ID已存在，请使用其他名称。');
}
