import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { StorageError } from '@my-pi-harness/storage';
import { PluginError, SkillError } from '@my-pi-harness/integrations';
import type { FastifyInstance } from 'fastify';
import { LoginError } from '../auth/errors.js';
import { OAuthLaunchError } from './oauth-launch-tickets.js';

/** Map application failures to bounded public errors without disclosing host details. */
export function registerRequestErrors(server: FastifyInstance): void {
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof SkillError || error instanceof PluginError) {
      const status = /NOT_FOUND/.test(error.code)
        ? 404
        : /CONFLICT|BUSY|STALE|CLOSED|REVOKED/.test(error.code)
          ? 409
          : 400;
      void reply.code(status).send({ code: error.code, message: error.message });
      return;
    }
    if (error instanceof LoginError || error instanceof OAuthLaunchError) {
      void reply.code(error.status).send({ code: error.code, message: error.message });
      return;
    }
    if (error instanceof StorageError && error.code === 'PROFILE_ACCOUNT_MISMATCH') {
      void reply
        .code(409)
        .send({ code: error.code, message: '当前本机数据已绑定其他账号，请使用原账号登录。' });
      return;
    }
    if (error instanceof StorageError && error.code === 'LOCAL_CLIENT_EXPIRED') {
      void reply.code(401).send({ code: error.code, message: '本机授权已过期，请重新授权。' });
      return;
    }
    if (error instanceof Error && 'validation' in error && error.validation) {
      void reply.code(400).send({ code: 'INVALID_REQUEST', message: '请求字段或类型无效。' });
      return;
    }
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      void reply
        .code(error.statusCode)
        .send({ code: 'INVALID_REQUEST', message: '请求格式无效。' });
      return;
    }
    if (error instanceof RuntimeError || error instanceof StorageError) {
      const missing = error.code.endsWith('NOT_FOUND');
      const conflict =
        /CONFLICT|BUSY|ACTIVE|CLOSED|SUSPENDED|DISABLED|CANCELLING|QUEUE_BRANCH_MISMATCH/.test(
          error.code,
        );
      const status =
        error.code === 'SESSION_UNAVAILABLE' || error.code === 'SESSION_LOG_UNAVAILABLE'
          ? 503
          : missing
            ? 404
            : conflict
              ? 409
              : error instanceof StorageError
                ? 500
                : 422;
      let message = status === 500 ? '持久化服务不可用。' : error.message;
      if (error.code === 'SESSION_LOG_UNAVAILABLE')
        message = '会话存储异常，写入结果需重启后确认。请勿重复执行操作。';
      void reply.code(status).send({ code: error.code, message });
      return;
    }
    request.log.error(
      { errorName: error instanceof Error ? error.name : 'unknown', requestId: request.id },
      'Application request failed',
    );
    void reply.code(500).send({ code: 'INTERNAL_ERROR', message: '本机服务无法完成请求。' });
  });
}
