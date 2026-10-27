import {
  AuthStatusSchema,
  LoginFlowSchema,
  LoginMethodSchema,
  PairingCodeResponseSchema,
  type LoginMethod,
} from '@my-pi-harness/protocol';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  clearLoginCallbackCookie,
  loginCallbackNonce,
  type LoginService,
} from './login-service.js';
import type { LocalAuth } from './local-auth.js';

const EmptySchema = Type.Object({}, { additionalProperties: false });
const IdParams = Type.Object(
  { id: Type.String({ pattern: '^login_[A-Za-z0-9_-]{1,100}$' }) },
  { additionalProperties: false },
);
const OkSchema = Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false });

/** Install trust, identity verification and application-session endpoints separately. */
export function registerAuthRoutes(
  server: FastifyInstance,
  auth: LocalAuth,
  login: LoginService,
  githubCallbackUrl: string | null = null,
): void {
  server.get('/api/auth/status', { schema: { response: { 200: AuthStatusSchema } } }, (request) =>
    auth.status(request),
  );
  server.post<{ Body: { code: string } }>(
    '/api/auth/pair',
    {
      schema: {
        body: Type.Object(
          { code: Type.String({ minLength: 1, maxLength: 128 }) },
          { additionalProperties: false },
        ),
        response: { 200: AuthStatusSchema },
      },
    },
    (request, reply) => {
      const grant = auth.pair(request.body.code);
      reply.header('set-cookie', grant.cookie);
      return grant.status;
    },
  );
  server.post<{ Body: { secret: string } }>(
    '/api/auth/desktop',
    {
      schema: {
        body: Type.Object(
          { secret: Type.String({ minLength: 40, maxLength: 128 }) },
          { additionalProperties: false },
        ),
        response: { 200: OkSchema },
      },
    },
    (request, reply) => {
      reply.header('set-cookie', auth.bootstrap(request.body.secret, request));
      return { ok: true };
    },
  );
  server.post<{ Body: { providerId: string; method?: LoginMethod } }>(
    '/api/auth/login',
    {
      schema: {
        body: Type.Object(
          {
            providerId: Type.String({ minLength: 1, maxLength: 100 }),
            method: Type.Optional(LoginMethodSchema),
          },
          { additionalProperties: false },
        ),
        response: { 200: LoginFlowSchema },
      },
    },
    async (request, reply) => {
      const client = auth.requireClient(request);
      if (request.body.method !== 'web') return login.start(client.id, request.body.providerId);
      const origin = auth.applicationOrigin(request);
      let callbackUrl = new URL(
        `/api/auth/callback/${encodeURIComponent(request.body.providerId)}`,
        origin,
      ).href;
      if (request.body.providerId === 'github' && githubCallbackUrl)
        callbackUrl = githubCallbackUrl;
      const started = await login.startWeb(client.id, request.body.providerId, callbackUrl, origin);
      reply.header('set-cookie', started.cookie);
      return started.flow;
    },
  );
  server.get<{
    Params: { providerId: string };
    Querystring: { state: string; code?: string; error?: string; iss?: string };
  }>(
    '/api/auth/callback/:providerId',
    {
      schema: {
        params: Type.Object(
          { providerId: Type.String({ pattern: '^[A-Za-z0-9_-]{1,80}$' }) },
          { additionalProperties: false },
        ),
        // OAuth response extensions are ignored; security fields keep explicit validation.
        querystring: Type.Object(
          {
            state: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }),
            code: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
            error: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
            error_description: Type.Optional(Type.String({ maxLength: 2048 })),
            error_uri: Type.Optional(Type.String({ maxLength: 2048 })),
            iss: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
          },
          { additionalProperties: true },
        ),
      },
    },
    async (request, reply) => {
      const target = await login.completeWeb(
        request.params.providerId,
        request.query.state,
        loginCallbackNonce(request.headers.cookie),
        request.query.code,
        request.query.error,
        request.query.iss,
      );
      reply.header('set-cookie', clearLoginCallbackCookie());
      reply.header('Referrer-Policy', 'no-referrer');
      return reply.code(303).redirect(target);
    },
  );
  server.get<{ Params: { id: string } }>(
    '/api/auth/login-flows/:id',
    { schema: { params: IdParams, response: { 200: LoginFlowSchema } } },
    (request) => login.get(auth.requireClient(request).id, request.params.id),
  );
  server.post<{ Params: { id: string } }>(
    '/api/auth/login-flows/:id/complete',
    { schema: { params: IdParams, body: EmptySchema, response: { 200: AuthStatusSchema } } },
    (request, reply) => {
      const identity = login.consume(auth.requireClient(request).id, request.params.id);
      const grant = auth.login(request, identity);
      reply.header('set-cookie', grant.cookie);
      return grant.status;
    },
  );
  server.delete<{ Params: { id: string } }>(
    '/api/auth/login-flows/:id',
    { schema: { params: IdParams, body: EmptySchema } },
    async (request, reply) => {
      await login.cancel(auth.requireClient(request).id, request.params.id);
      reply.header('set-cookie', clearLoginCallbackCookie());
      return reply.code(204).send();
    },
  );
  server.post(
    '/api/auth/logout',
    { schema: { body: EmptySchema, response: { 200: OkSchema } } },
    async (request, reply) => {
      const client = auth.requireClient(request);
      auth.logout(request);
      await login.cancelClient(client.id);
      reply.header('set-cookie', [auth.clearLoginCookie(), clearLoginCallbackCookie()]);
      return { ok: true };
    },
  );
  server.post(
    '/api/auth/pairing-code',
    { schema: { body: EmptySchema, response: { 200: PairingCodeResponseSchema } } },
    () => ({ code: auth.getPairingCode() }),
  );
}
