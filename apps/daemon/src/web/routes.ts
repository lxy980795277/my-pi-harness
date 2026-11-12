import {
  WebCredentialInputSchema,
  WebServiceStatusSchema,
  type WebCredentialInput,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import type { WebService } from './service';

const EMPTY_INPUT = Type.Object({}, { additionalProperties: false });

/** Application login and CSRF protect dedicated web credentials; no key is returned. */
export function registerWebRoutes(server: FastifyInstance, web: WebService): void {
  server.get(
    '/api/web/status',
    {
      schema: { response: { 200: WebServiceStatusSchema } },
    },
    () => web.status(),
  );
  server.put<{ Body: WebCredentialInput }>(
    '/api/web/credential',
    {
      schema: { body: WebCredentialInputSchema, response: { 200: WebServiceStatusSchema } },
    },
    async (request) => {
      const key = request.body.apiKey;
      request.body.apiKey = '';
      return await web.setCredential(key);
    },
  );
  server.delete(
    '/api/web/credential',
    {
      schema: { body: EMPTY_INPUT, response: { 200: WebServiceStatusSchema } },
    },
    () => web.setCredential(undefined),
  );
}
