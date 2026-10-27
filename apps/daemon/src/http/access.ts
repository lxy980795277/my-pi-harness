import type { FastifyInstance } from 'fastify';
import type { ApplicationServices } from '../application/services.js';

/** Enforce source trust, application login and CSRF before protected routes. */
export function registerRequestAccess(
  server: FastifyInstance,
  services: Pick<ApplicationServices, 'auth' | 'authorizeSkillGateway'>,
): void {
  const { auth } = services;
  server.addHook('onRequest', (request, reply, done) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || path === '/api/health' || path === '/api/runtime/events') {
      done();
      return;
    }
    const bootstrap = path === '/api/auth/desktop';
    const skillGateway =
      request.method === 'GET' && /^\/api\/skill-gateway\/[a-z][a-z0-9-]*\//.test(path);
    const oauthLaunch =
      request.method === 'POST' &&
      (/^\/api\/skill-connections\/[a-z][a-z0-9-]*\/oauth\/launch$/.test(path) ||
        /^\/api\/mcp\/remote-servers\/[A-Za-z0-9_-]+\/oauth\/launch$/.test(path));
    const callback =
      request.method === 'GET' &&
      (/^\/api\/auth\/callback\/[A-Za-z0-9_-]+$/.test(path) ||
        path === '/api/mcp/oauth/callback' ||
        /^\/api\/connections\/oauth\/callback\/(github|google|vercel|notion|supabase)$/.test(
          path,
        ) ||
        /^\/api\/skill-connections\/[a-z][a-z0-9-]*\/oauth\/callback$/.test(path));
    if (callback) reply.header('Referrer-Policy', 'no-referrer');
    const write = !['GET', 'HEAD'].includes(request.method);
    if (!auth.trustedSource(request, write && !bootstrap)) {
      void reply.code(403).send({ code: 'SOURCE_REJECTED', message: '请求来源未授权。' });
      return;
    }
    if (
      skillGateway &&
      !services.authorizeSkillGateway(request.headers['x-pi-harness-skill-gateway'])
    ) {
      void reply
        .code(403)
        .send({ code: 'SKILL_GATEWAY_FORBIDDEN', message: '插件网关请求未授权。' });
      return;
    }
    const publicRoute =
      ['/api/auth/status', '/api/auth/pair'].includes(path) ||
      bootstrap ||
      callback ||
      skillGateway ||
      oauthLaunch;
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
}
