import {
  AuthFlowSchema,
  AuthStatusSchema,
  AuthUrlResponseSchema,
  PairingCodeResponseSchema,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import type { GitHubAuth } from './github-auth.js';
import type { LocalAuth } from './local-auth.js';

const CodeSchema = Type.Object(
  { code: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);
const SecretSchema = Type.Object(
  { secret: Type.String({ minLength: 40, maxLength: 128 }) },
  { additionalProperties: false },
);
const ErrorSchema = Type.Object(
  { code: Type.String(), message: Type.String() },
  { additionalProperties: false },
);
const EmptySchema = Type.Object({}, { additionalProperties: false });

/** Install local authentication endpoints and optional application GitHub identity. */
export function registerAuthRoutes(
  server: FastifyInstance,
  auth: LocalAuth,
  github?: GitHubAuth,
): void {
  server.get('/api/auth/status', { schema: { response: { 200: AuthStatusSchema } } }, (request) =>
    auth.status(request),
  );
  server.post<{ Body: { code: string } }>(
    '/api/auth/pair',
    { schema: { body: CodeSchema, response: { 200: AuthStatusSchema } } },
    (request, reply) => {
      try {
        const grant = auth.pair(request.body.code);
        reply.header('set-cookie', grant.cookie);
        return {
          authenticated: true,
          csrfToken: grant.csrfToken,
          githubConfigured: github !== undefined,
          identity: null,
        };
      } catch (error: unknown) {
        const limited = error instanceof Error && error.message === 'PAIR_RATE_LIMIT';
        return reply.code(limited ? 429 : 401).send({
          code: limited ? 'PAIR_RATE_LIMIT' : 'PAIR_INVALID',
          message: '配对码无效或已过期。',
        });
      }
    },
  );
  server.post<{ Body: { secret: string } }>(
    '/api/auth/desktop',
    { schema: { body: SecretSchema } },
    (request, reply) => {
      try {
        return reply.header('set-cookie', auth.bootstrap(request.body.secret)).send({ ok: true });
      } catch {
        return reply.code(401).send({ code: 'OWNER_INVALID', message: '桌面授权失败。' });
      }
    },
  );
  server.post('/api/auth/logout', { schema: { body: EmptySchema } }, async (request, reply) => {
    await github?.cancelPending();
    auth.logout(request);
    return reply.header('set-cookie', auth.clearCookie()).send({ ok: true });
  });
  server.get(
    '/api/auth/pairing-code',
    { schema: { response: { 200: PairingCodeResponseSchema } } },
    () => ({ code: auth.getPairingCode() }),
  );
  server.get(
    '/api/auth/github/start',
    { schema: { response: { 200: AuthUrlResponseSchema, 409: ErrorSchema } } },
    (request, reply) => {
      if (!github)
        return reply
          .code(409)
          .send({ code: 'GITHUB_NOT_CONFIGURED', message: '尚未配置 GitHub 应用。' });
      try {
        return { url: github.startWeb(`http://${request.headers.host ?? ''}`) };
      } catch {
        return reply.code(409).send({
          code: 'GITHUB_WEB_CONFIG_REQUIRED',
          message: '浏览器 GitHub 登录需要应用 client secret，请由应用所有者配置。',
        });
      }
    },
  );
  server.post(
    '/api/auth/github/device',
    { schema: { body: EmptySchema, response: { 200: AuthFlowSchema, 409: ErrorSchema } } },
    async (_request, reply) => {
      if (!github)
        return reply
          .code(409)
          .send({ code: 'GITHUB_NOT_CONFIGURED', message: '尚未配置 GitHub 应用。' });
      return github.startDevice();
    },
  );
  server.get<{ Querystring: { state: string; code: string } }>(
    '/api/auth/github/callback',
    {
      schema: {
        querystring: Type.Object(
          {
            state: Type.String({ minLength: 40, maxLength: 128 }),
            code: Type.String({ minLength: 1, maxLength: 1024 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      if (!github)
        return reply
          .code(409)
          .send({ code: 'GITHUB_NOT_CONFIGURED', message: '尚未配置 GitHub 应用。' });
      try {
        await github.finishWeb(request.query.state, request.query.code);
        return reply.code(303).header('location', '/').send();
      } catch {
        return reply
          .code(400)
          .send({ code: 'GITHUB_AUTH_FAILED', message: 'GitHub 登录失败或已过期。' });
      }
    },
  );
}
