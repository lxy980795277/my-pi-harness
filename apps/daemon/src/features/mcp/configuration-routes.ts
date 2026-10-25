import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { McpImportDocumentSchema, type McpImportDocument } from '@my-pi-harness/protocol';
import type { McpService } from './service.js';
import type { RemoteMcpService } from './remote-service.js';
const Preview = Type.Object(
  {
    local: Type.Array(Type.String()),
    remote: Type.Array(Type.String()),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

/** Import validates every configuration before creating disabled records; no credential or trust is imported. */
export function registerMcpConfigurationRoutes(
  server: FastifyInstance,
  local: McpService,
  remote: RemoteMcpService,
): void {
  let importing = false;
  const prepare = async (input: McpImportDocument): Promise<McpImportDocument> => {
    const names = new Set([
      ...local.list().map((value) => value.name),
      ...remote.list().map((value) => value.name),
    ]);
    const result: McpImportDocument = { version: 1, local: [], remote: [] };
    for (const item of input.local) {
      const value = await local.prepareInput(item);
      if (names.has(value.name))
        throw new RuntimeError('MCP_IMPORT_CONFLICT', '导入名称重复或已存在。');
      names.add(value.name);
      result.local.push(value);
    }
    for (const item of input.remote) {
      const value = remote.prepareInput(item);
      if (names.has(value.name))
        throw new RuntimeError('MCP_IMPORT_CONFLICT', '导入名称重复或已存在。');
      names.add(value.name);
      result.remote.push(value);
    }
    return result;
  };
  server.get(
    '/api/mcp/configuration/export',
    { schema: { response: { 200: McpImportDocumentSchema } } },
    (): McpImportDocument => ({
      version: 1,
      local: local.list().map((value) => ({
        name: value.name,
        workspaceId: value.workspaceId,
        command: value.command,
        args: value.args,
        publicEnvironment: value.publicEnvironment,
        secretSlots: value.secretSlots.map((slot) => ({
          slotId: slot.slotId,
          environmentName: slot.environmentName,
        })),
      })),
      remote: remote.list().map((value) => ({
        name: value.name,
        transport: value.transport,
        endpoint: value.endpoint,
        publicHeaders: value.publicHeaders,
        secretHeaders: value.secretHeaders.map((slot) => ({
          slotId: slot.slotId,
          headerName: slot.headerName,
        })),
        oauth: value.oauth,
        ...(value.oauthClient === undefined ? {} : { oauthClient: value.oauthClient }),
        ...(value.connectionId === undefined ? {} : { connectionId: value.connectionId }),
      })),
    }),
  );
  server.post<{ Body: McpImportDocument }>(
    '/api/mcp/configuration/preview',
    {
      bodyLimit: 2 * 1024 * 1024,
      schema: { body: McpImportDocumentSchema, response: { 200: Preview } },
    },
    async (request) => {
      const input = await prepare(request.body);
      return {
        local: input.local.map((item) => item.name),
        remote: input.remote.map((item) => item.name),
        warnings: ['导入项保持停用，秘密需要重新配置，启动及远端授权需要重新确认。'],
      };
    },
  );
  server.post<{ Body: McpImportDocument }>(
    '/api/mcp/configuration/import',
    {
      bodyLimit: 2 * 1024 * 1024,
      schema: { body: McpImportDocumentSchema, response: { 200: Preview } },
    },
    async (request) => {
      if (importing) throw new RuntimeError('MCP_BUSY', '另一批MCP配置正在导入。');
      importing = true;
      const created: { id: string; revision: number; remote: boolean }[] = [];
      try {
        const input = await prepare(request.body);
        for (const item of input.local) {
          const result = await local.create(item);
          created.push({ id: result.id, revision: result.revision, remote: false });
        }
        for (const item of input.remote) {
          const result = remote.create(item);
          created.push({ id: result.id, revision: result.revision, remote: true });
        }
        return {
          local: input.local.map((item) => item.name),
          remote: input.remote.map((item) => item.name),
          warnings: ['已创建停用配置，请逐项配置秘密并确认授权。'],
        };
      } catch (error) {
        const rollbacks = await Promise.allSettled(
          created.reverse().map(async (item) => {
            if (item.remote) await remote.remove(item.id, item.revision);
            else await local.remove(item.id, item.revision);
          }),
        );
        if (rollbacks.some((result) => result.status === 'rejected'))
          throw new RuntimeError(
            'MCP_IMPORT_ROLLBACK_FAILED',
            '导入失败且部分配置无法回滚，请检查MCP列表。',
          );
        throw error;
      } finally {
        importing = false;
      }
    },
  );
}
