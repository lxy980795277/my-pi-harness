import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { McpError, SkillError } from '@my-pi-harness/integrations';
import type { ToolDiscoveryDiagnostic } from '@my-pi-harness/protocol';
import { StorageError } from '@my-pi-harness/storage';

/** Only finite host-owned categories become model-visible or public discovery diagnostics. */
export function catalogFailure(
  error: unknown,
  timedOut = false,
): NonNullable<ToolDiscoveryDiagnostic['error']> {
  if (timedOut || (error instanceof Error && error.name === 'TimeoutError'))
    return { code: 'MCP_CATALOG_TIMEOUT', message: 'MCP工具目录准备超时，请检查连接后重试。' };
  if (error instanceof StorageError)
    return {
      code: 'MCP_CATALOG_STORAGE_FAILED',
      message: '无法读取或保存本机MCP目录缓存，请检查应用数据目录。',
    };
  const code =
    error instanceof RuntimeError || error instanceof McpError || error instanceof SkillError
      ? error.code
      : '';
  switch (code) {
    case 'MCP_PREPARATION_TIMEOUT':
      return { code: 'MCP_CATALOG_TIMEOUT', message: 'MCP工具目录准备超时，请检查连接后重试。' };
    case 'AUTHENTICATION_REQUIRED':
    case 'MCP_CREDENTIAL_REQUIRED':
    case 'SKILL_CONNECTION_REQUIRED':
    case 'MCP_CONNECTION_UNAVAILABLE':
    case 'MCP_IDENTITY_REQUIRED':
    case 'OAUTH_REQUIRED':
    case 'OAUTH_EXPIRED':
    case 'OAUTH_CREDENTIAL_INVALID':
      return {
        code: 'MCP_CATALOG_AUTH_REQUIRED',
        message: 'MCP服务未授权、授权已失效或权限不足，请在设置中检查授权。',
      };
    case 'MCP_DISABLED':
    case 'MCP_PLUGIN_DISABLED':
    case 'MCP_CONFLICT':
    case 'MCP_PLUGIN_TARGET':
      return {
        code: 'MCP_CATALOG_AUTHORITY_CHANGED',
        message: 'MCP配置或启动授权已变化，请重新确认该服务。',
      };
    case 'DNS_FAILED':
    case 'NETWORK_FAILED':
    case 'REMOTE_CONNECTION_FAILED':
    case 'CONNECTION_FAILED':
      return {
        code: 'MCP_CATALOG_CONNECTION_FAILED',
        message: '无法连接MCP服务或完成握手，请检查服务地址与网络。',
      };
    case 'INVALID_CATALOG':
    case 'INVALID_METADATA':
    case 'METADATA_LIMIT':
    case 'CATALOG_LIMIT':
    case 'SECRET_ECHO':
    case 'RESPONSE_LIMIT':
      return {
        code: 'MCP_CATALOG_INVALID',
        message: '服务返回无效、超限或含秘密的能力目录，已拒绝加载。',
      };
    default:
      return {
        code: 'MCP_CATALOG_FAILED',
        message: '准备MCP目录时发生异常，请重试或查看本机服务日志。',
      };
  }
}
