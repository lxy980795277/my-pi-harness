import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { StorageError } from '@my-pi-harness/storage';
import type { FastifyInstance } from 'fastify';
import type { ApplicationServices } from '../services.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerModelRoutes } from './models/routes.js';
import { registerSessionRoutes } from './sessions/routes.js';
import { registerWorkspaceRoutes } from './workspaces/routes.js';
import { registerToolRoutes } from './tools/routes.js';

/** Install protected M1 endpoints; health and public process identity remain readable. */
export function registerM1Routes(server: FastifyInstance, services: ApplicationServices): void {
  const { auth, github, gateway, runtime } = services;
  server.addHook('onRequest', (request, reply, done) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || path === '/api/health' || path === '/api/runtime/events') {
      done();
      return;
    }
    const bootstrap = path === '/api/auth/desktop';
    const callback = path === '/api/auth/github/callback';
    const write = !['GET', 'HEAD'].includes(request.method);
    if (!auth.trustedSource(request, write && !bootstrap)) {
      void reply.code(403).send({ code: 'SOURCE_REJECTED', message: '请求来源未授权。' });
      return;
    }
    const publicRoute =
      ['/api/auth/status', '/api/auth/pair'].includes(path) || bootstrap || callback;
    if (!publicRoute && !auth.isAuthorized(request)) {
      void reply.code(401).send({ code: 'AUTH_REQUIRED', message: '请先完成本机授权。' });
      return;
    }
    if (write && !publicRoute && !auth.csrfValid(request)) {
      void reply.code(403).send({ code: 'CSRF_REJECTED', message: '请求授权已失效。' });
      return;
    }
    done();
  });
  server.setErrorHandler((error, request, reply) => {
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
        error.code === 'SESSION_UNAVAILABLE'
          ? 503
          : missing
            ? 404
            : conflict
              ? 409
              : error instanceof StorageError
                ? 500
                : 422;
      void reply
        .code(status)
        .send({ code: error.code, message: status === 500 ? '持久化服务不可用。' : error.message });
      return;
    }
    request.log.error(
      { errorName: error instanceof Error ? error.name : 'unknown', requestId: request.id },
      'Application request failed',
    );
    void reply.code(500).send({ code: 'INTERNAL_ERROR', message: '本机服务无法完成请求。' });
  });
  registerAuthRoutes(server, auth, github);
  registerModelRoutes(server, gateway, github);
  registerSessionRoutes(server, runtime, services.store, auth, gateway, services.workspaces);
  registerWorkspaceRoutes(server, services.workspaces);
  registerToolRoutes(server, services.tools);
  server.addHook('preClose', async () => {
    await services.close();
  });
  server.addHook('onClose', async () => {
    await services.close();
  });
}
