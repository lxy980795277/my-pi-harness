import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  RemoteMcpInputSchema,
  type RemoteMcpInput,
  type RemoteMcpView,
} from '@my-pi-harness/protocol';
import type {
  PreparedRemoteMcpDraft,
  RemoteMcpDraft,
  RemoteMcpHeaderDraft,
} from '@/features/mcp/types/remote-mcp';

const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,127}$/;
const CONTROL_CHARACTERS = /[\r\n\0]/;
const OBJECT = { additionalProperties: false } as const;
const HEADER_NAME_SCHEMA = Type.String({ pattern: HEADER_NAME.source });
const JSON_CONFIGURATION_SCHEMA = Type.Object(
  {
    url: Type.String({ maxLength: 8192 }),
    type: Type.Optional(Type.Enum(['streamable-http', 'http', 'sse'])),
    headers: Type.Optional(
      Type.Record(HEADER_NAME_SCHEMA, Type.String({ maxLength: 65536 }), { maxProperties: 16 }),
    ),
    publicHeaders: Type.Optional(RemoteMcpInputSchema.properties.publicHeaders),
    secretHeaders: Type.Optional(RemoteMcpInputSchema.properties.secretHeaders),
    oauth: Type.Optional(Type.Boolean()),
    connectionId: RemoteMcpInputSchema.properties.connectionId,
    oauthClient: RemoteMcpInputSchema.properties.oauthClient,
  },
  OBJECT,
);
const JSON_DOCUMENT_SCHEMA = Type.Object(
  {
    mcpServers: Type.Record(Type.String({ maxLength: 120 }), JSON_CONFIGURATION_SCHEMA, {
      minProperties: 1,
      maxProperties: 1,
    }),
  },
  OBJECT,
);

function checkHeaders(headers: readonly RemoteMcpHeaderDraft[]): void {
  const names = new Set<string>();
  const slots = new Set<string>();
  let publicCount = 0;
  for (const header of headers) {
    if (!HEADER_NAME.test(header.name) || CONTROL_CHARACTERS.test(header.value))
      throw new Error('Header 名称无效，或值包含换行与控制字符。');
    const name = header.name.toLowerCase();
    if (names.has(name)) throw new Error('Header 名称不能重复，大小写视为相同。');
    names.add(name);
    if (header.kind === 'public') {
      publicCount += 1;
      if (header.value.length > 8192) throw new Error('公开 Header 超过大小限制。');
      continue;
    }
    if (header.value.length > 65536) throw new Error('秘密 Header 超过大小限制。');
    if (
      header.slotId.length === 0 ||
      header.slotId === '__oauth_client_secret__' ||
      slots.has(header.slotId)
    )
      throw new Error('秘密 Header 槽位无效或重复。');
    slots.add(header.slotId);
  }
  if (publicCount > 32 || slots.size > 16) throw new Error('Header 数量超过限制。');
}

function attachAuthentication(input: RemoteMcpInput, draft: RemoteMcpDraft): void {
  if (draft.connectionId !== undefined) input.connectionId = draft.connectionId;
  if (draft.oauthClient !== undefined) input.oauthClient = Value.Clone(draft.oauthClient);
}

/** Build an editor copy from safe metadata; saved credentials are never read into the draft. */
export function createRemoteMcpDraft(server: RemoteMcpView | null): RemoteMcpDraft {
  if (server === null)
    return {
      mcpId: '',
      transport: 'streamable-http',
      endpoint: '',
      headers: [],
      oauth: false,
    };
  const headers: RemoteMcpHeaderDraft[] = Object.entries(server.publicHeaders).map(
    ([name, value]) => {
      return {
        id: crypto.randomUUID(),
        name,
        value,
        slotId: '',
        configured: false,
        kind: 'public',
      };
    },
  );
  headers.push(
    ...server.secretHeaders.map((slot): RemoteMcpHeaderDraft => {
      return {
        id: crypto.randomUUID(),
        name: slot.headerName,
        value: '',
        slotId: slot.slotId,
        configured: slot.configured,
        kind: 'secret',
      };
    }),
  );
  const draft: RemoteMcpDraft = {
    mcpId: server.name,
    transport: server.transport,
    endpoint: server.endpoint,
    headers,
    oauth: server.oauth,
  };
  if (server.connectionId !== undefined) draft.connectionId = server.connectionId;
  if (server.oauthClient !== undefined) draft.oauthClient = Value.Clone(server.oauthClient);
  return draft;
}

/** Encode local edits, explicit public values and value-free references to saved slots. */
export function encodeRemoteMcpDraft(draft: RemoteMcpDraft): string {
  checkHeaders(draft.headers);
  const headers: Record<string, string> = {};
  const publicHeaders: Record<string, string> = {};
  const secretHeaders: RemoteMcpInput['secretHeaders'] = [];
  for (const header of draft.headers) {
    if (header.kind === 'public') publicHeaders[header.name] = header.value;
    else if (header.configured && header.value.length === 0)
      secretHeaders.push({ slotId: header.slotId, headerName: header.name });
    else headers[header.name] = header.value;
  }
  const config: Record<string, unknown> = {
    url: draft.endpoint,
    type: draft.transport,
    headers,
    publicHeaders,
    secretHeaders,
    oauth: draft.oauth,
  };
  if (draft.connectionId !== undefined) config['connectionId'] = draft.connectionId;
  if (draft.oauthClient !== undefined) config['oauthClient'] = draft.oauthClient;
  return JSON.stringify({ mcpServers: { [draft.mcpId]: config } }, null, 2);
}

/** Parse exactly one HTTP/SSE entry; pasted header bytes remain private editor state. */
export function parseRemoteMcpDraft(encoded: string): RemoteMcpDraft {
  if (encoded.length > 2 * 1024 * 1024) throw new Error('MCP JSON 超过大小限制。');
  let document: unknown;
  try {
    document = JSON.parse(encoded);
  } catch {
    // Native JSON errors may echo credential bytes from the input.
    throw new Error('MCP JSON 无法解析，请检查语法。');
  }
  if (!Value.Check(JSON_DOCUMENT_SCHEMA, document))
    throw new Error('MCP JSON 只支持一个 HTTP/SSE 配置，请检查字段与类型。');
  const entry = Object.entries(document.mcpServers)[0];
  if (entry === undefined) throw new Error('MCP JSON 必须包含一个配置。');
  const [mcpId, config] = entry;
  if (mcpId.length > 120) throw new Error('MCP ID 最多为 120 个字符。');
  const draft = createRemoteMcpDraft(null);
  draft.mcpId = mcpId;
  draft.endpoint = config.url;
  if (config.type === 'sse') draft.transport = 'sse';
  if (config.oauth !== undefined) draft.oauth = config.oauth;
  if (config.connectionId !== undefined) draft.connectionId = config.connectionId;
  if (config.oauthClient !== undefined) draft.oauthClient = Value.Clone(config.oauthClient);
  for (const [name, value] of Object.entries(config.headers ?? {}))
    draft.headers.push({
      id: crypto.randomUUID(),
      name,
      value,
      slotId: crypto.randomUUID(),
      configured: false,
      kind: 'secret',
    });
  for (const [name, value] of Object.entries(config.publicHeaders ?? {}))
    draft.headers.push({
      id: crypto.randomUUID(),
      name,
      value,
      slotId: '',
      configured: false,
      kind: 'public',
    });
  for (const slot of config.secretHeaders ?? [])
    draft.headers.push({
      id: crypto.randomUUID(),
      name: slot.headerName,
      value: '',
      slotId: slot.slotId,
      configured: true,
      kind: 'secret',
    });
  checkHeaders(draft.headers);
  return draft;
}

/** Validate saved-slot ownership before separating public configuration from credential writes. */
export function prepareRemoteMcpDraft(
  draft: RemoteMcpDraft,
  original: RemoteMcpView | null,
): PreparedRemoteMcpDraft {
  checkHeaders(draft.headers);
  const input: RemoteMcpInput = {
    name: draft.mcpId.trim(),
    transport: draft.transport,
    endpoint: draft.endpoint.trim(),
    publicHeaders: {},
    secretHeaders: [],
    oauth: draft.oauth,
  };
  attachAuthentication(input, draft);
  const secrets: PreparedRemoteMcpDraft['secrets'] = [];
  for (const header of draft.headers) {
    if (header.kind === 'public') {
      if (/authorization|token|secret|api.?key/i.test(header.name))
        throw new Error('认证 Header 必须使用秘密值。');
      input.publicHeaders[header.name] = header.value;
      continue;
    }
    input.secretHeaders.push({ slotId: header.slotId, headerName: header.name });
    if (header.value.length > 0) {
      secrets.push({ slotId: header.slotId, value: header.value });
      continue;
    }
    if (original === null || !header.configured)
      throw new Error('请填写秘密 Header 值，或移除未配置的 Header。');
    const saved = original.secretHeaders.find((slot) => {
      return (
        slot.slotId === header.slotId && slot.headerName.toLowerCase() === header.name.toLowerCase()
      );
    });
    if (saved?.configured !== true)
      throw new Error('请填写秘密 Header 值，或移除未配置的 Header。');
    if (input.endpoint !== original.endpoint || input.transport !== original.transport)
      throw new Error('地址或传输方式已变化，请重新填写秘密 Header 值。');
  }
  if (!Value.Check(RemoteMcpInputSchema, input)) throw new Error('MCP 配置字段无效。');
  const authorization = draft.headers.some((header) => {
    return header.name.toLowerCase() === 'authorization';
  });
  if (input.connectionId !== undefined && (input.oauth || authorization))
    throw new Error('服务连接不能同时使用独立 OAuth 或 Authorization Header。');
  if (input.oauth && authorization)
    throw new Error('独立 OAuth 不能同时使用 Authorization Header。');
  if (!input.oauth && input.oauthClient !== undefined)
    throw new Error('预注册 OAuth 客户端需要启用独立 OAuth。');
  return { input, secrets };
}

/** Discard pending credential bytes without silently restoring a credential they replaced. */
export function clearRemoteMcpDraftSecrets(draft: RemoteMcpDraft): RemoteMcpDraft {
  return {
    ...draft,
    headers: draft.headers.map((header) => {
      if (header.kind === 'public') return { ...header };
      if (header.value.length > 0) return { ...header, value: '', configured: false };
      return { ...header };
    }),
  };
}
