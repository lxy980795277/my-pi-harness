import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { StorageError } from '@my-pi-harness/storage';
import type { FastifyInstance } from 'fastify';
import type { ApplicationServices } from '../services.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerModelRoutes } from './models/routes.js';
import { registerSessionRoutes } from './sessions/routes.js';
import { registerSessionLogRoute } from './sessions/log-route.js';
import { registerOfficeArtifactRoute } from './sessions/artifact-route.js';
import { registerWorkspaceRoutes } from './workspaces/routes.js';
import { registerToolRoutes } from './tools/routes.js';
import { registerWorkRoutes } from './work/routes.js';
import { registerAttachmentRoutes } from './attachments/routes.js';
import { LoginError } from './auth/errors.js';
import { registerMcpRoutes } from './mcp/routes.js';
import { SkillError } from '@my-pi-harness/integrations';
import { registerSkillRoutes } from './skills/routes.js';
import { registerPluginRoutes } from './plugins/routes.js';
import { registerRemoteMcpRoutes } from './mcp/remote-routes.js';
import { registerMcpDirectoryRoutes } from './mcp/directory-routes.js';
import { registerMcpConfigurationRoutes } from './mcp/configuration-routes.js';
import { registerConnectionRoutes } from './connections/routes.js';

/** Install protected M1 endpoints; health and public process identity remain readable. */
export function registerM1Routes(server: FastifyInstance, services: ApplicationServices): void {
  const { auth, login, gateway, runtime } = services;
  server.addHook('onRequest', (request, reply, done) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || path === '/api/health' || path === '/api/runtime/events') {
      done();
      return;
    }
    const bootstrap = path === '/api/auth/desktop';
    const callback =
      request.method === 'GET' &&
      (/^\/api\/auth\/callback\/[A-Za-z0-9_-]+$/.test(path) ||
        path === '/api/mcp/oauth/callback' ||
        /^\/api\/connections\/oauth\/callback\/(github|google|vercel|notion|supabase)$/.test(path));
    if (callback) reply.header('Referrer-Policy', 'no-referrer');
    const write = !['GET', 'HEAD'].includes(request.method);
    if (!auth.trustedSource(request, write && !bootstrap)) {
      void reply.code(403).send({ code: 'SOURCE_REJECTED', message: '请求来源未授权。' });
      return;
    }
    const publicRoute =
      ['/api/auth/status', '/api/auth/pair'].includes(path) || bootstrap || callback;
    const trustOnly =
      ['/api/auth/login', '/api/auth/logout'].includes(path) ||
      /^\/api\/auth\/login-flows\/login_[A-Za-z0-9_-]+(?:\/complete)?$/.test(path);
    if (!publicRoute && !auth.client(request)) {
      void reply.code(401).send({ code: 'LOCAL_AUTH_REQUIRED', message: '请先完成本机授权。' });
      return;
    }
    if (!publicRoute && !trustOnly && !auth.isAuthorized(request)) {
      void reply.code(401).send({ code: 'LOGIN_REQUIRED', message: '请先登录。' });
      return;
    }
    if (write && !publicRoute && !auth.csrfValid(request)) {
      void reply.code(403).send({ code: 'CSRF_REJECTED', message: '请求授权已失效。' });
      return;
    }
    done();
  });
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof SkillError) {
      const status = /NOT_FOUND/.test(error.code)
        ? 404
        : /CONFLICT|BUSY|STALE|CLOSED|REVOKED/.test(error.code)
          ? 409
          : 400;
      void reply.code(status).send({ code: error.code, message: error.message });
      return;
    }
    if (error instanceof LoginError) {
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
  registerAuthRoutes(server, auth, login, services.githubCallbackUrl);
  registerModelRoutes(server, gateway);
  registerSessionRoutes(server, runtime, auth, gateway, services.workspaces);
  registerSessionLogRoute(server, services.store);
  registerOfficeArtifactRoute(server, runtime, services.workspaces);
  registerWorkspaceRoutes(server, services.workspaces);
  registerToolRoutes(server, services.tools);
  registerWorkRoutes(server, services.work);
  registerAttachmentRoutes(server, services.attachments);
  registerMcpRoutes(server, services.mcp);
  registerRemoteMcpRoutes(server, services.remoteMcp);
  registerMcpDirectoryRoutes(server, services.mcp, services.remoteMcp);
  registerMcpConfigurationRoutes(server, services.mcp, services.remoteMcp);
  registerSkillRoutes(server, services.skills);
  registerPluginRoutes(server, services.plugins);
  registerConnectionRoutes(server, services.connections);
  server.addHook('preClose', async () => {
    await services.close();
  });
  server.addHook('onClose', async () => {
    await services.close();
  });
}
