import { randomUUID } from 'node:crypto';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { McpError, parseRemoteUrl, type RemoteMcpManager } from '@my-pi-harness/integrations';
import type { RemoteMcpDraftTestInput, RemoteMcpDraftTestResult } from '@my-pi-harness/protocol';
import { validateRemoteHeader } from './remote-configuration.js';

/** One explicit probe owns transient headers and a fresh SDK lease, with no persistent authority. */
export async function testRemoteMcpDraft(
  manager: RemoteMcpManager,
  input: RemoteMcpDraftTestInput,
  signal: AbortSignal,
  fixtureOrigin?: string,
): Promise<RemoteMcpDraftTestResult> {
  const deadline = AbortSignal.timeout(30000);
  const ownedSignal = AbortSignal.any([signal, deadline]);
  const started = performance.now();
  try {
    const endpoint = parseRemoteUrl(input.endpoint, fixtureOrigin).toString();
    const names = new Set<string>();
    const secrets: string[] = [];
    for (const [name, value] of Object.entries(input.headers)) {
      validateRemoteHeader(name, value, names);
      if (value.length > 0) {
        secrets.push(value);
        const token = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value)?.[1];
        if (token !== undefined) secrets.push(token);
      }
    }
    if (Buffer.byteLength(JSON.stringify(input.headers)) > 65536)
      throw new RuntimeError('MCP_HEADER_INVALID', '测试请求头总量不能超过64KiB。');
    const catalog = await manager.discover(
      {
        serverId: `draft:${randomUUID()}`,
        endpoint,
        transport: input.transport,
        headers: { ...input.headers },
        secrets,
        authorizationKey: randomUUID(),
      },
      { signal: ownedSignal },
    );
    ownedSignal.throwIfAborted();
    return {
      connected: true,
      toolCount: catalog.tools.length,
      resourceCount: catalog.resources?.length ?? 0,
      promptCount: catalog.prompts?.length ?? 0,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    };
  } catch (error) {
    if (signal.aborted) throw new RuntimeError('MCP_TEST_CANCELLED', 'MCP连接测试已取消。');
    if (deadline.aborted)
      throw new RuntimeError('MCP_TEST_TIMEOUT', 'MCP连接测试超过30秒，请检查服务后重试。');
    if (error instanceof RuntimeError) throw error;
    if (error instanceof McpError) throw new RuntimeError(error.code, error.message);
    throw new RuntimeError('MCP_TEST_FAILED', 'MCP连接测试失败，请检查地址、协议和认证设置。');
  }
}
