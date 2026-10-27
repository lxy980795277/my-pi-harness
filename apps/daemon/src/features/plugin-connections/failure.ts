import { PluginOAuthError, SkillError } from '@my-pi-harness/integrations';
import { StorageError } from '@my-pi-harness/storage';

interface PluginOAuthFailure {
  phase: PluginOAuthError['phase'] | 'state' | 'credentials' | 'internal';
  reason: PluginOAuthError['reason'] | 'expired-state' | 'storage-failed' | 'unexpected';
  message: string;
  upstreamStatus?: number;
}

/** Only owned error categories may become callback diagnostics or result-page text. */
export function describePluginOAuthFailure(error: unknown): PluginOAuthFailure {
  if (error instanceof PluginOAuthError)
    return {
      phase: error.phase,
      reason: error.reason,
      message: error.message,
      ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
    };
  if (error instanceof SkillError && error.code === 'SKILL_OAUTH_STATE_INVALID')
    return {
      phase: 'state',
      reason: 'expired-state',
      message: '授权流程已过期、已被使用或本机服务已重启，请返回应用重新点击授权。',
    };
  if (error instanceof Error && error.name === 'AbortError')
    return {
      phase: 'state',
      reason: 'cancelled',
      message: '授权已被取消或应用状态已改变，请返回应用重新授权。',
    };
  if (error instanceof Error && error.name === 'TimeoutError')
    return {
      phase: 'internal',
      reason: 'timeout',
      message: '授权回调处理超时，请检查网络后重新授权。',
    };
  if (
    error instanceof StorageError ||
    (error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      ['EACCES', 'EPERM', 'ENOSPC', 'EDQUOT', 'EROFS', 'ENOENT', 'EIO'].includes(error.code))
  )
    return {
      phase: 'credentials',
      reason: 'storage-failed',
      message: '无法保存本机插件凭据，请检查应用数据目录权限和磁盘空间后重新授权。',
    };
  return {
    phase: 'internal',
    reason: 'unexpected',
    message: '本机服务处理授权时发生异常，请查看本机服务日志后重新授权。',
  };
}
