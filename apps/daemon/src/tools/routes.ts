import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { ToolDecisionInputSchema, type ToolDecisionInput } from '@my-pi-harness/protocol';
import type { ToolRuntime } from '@my-pi-harness/agent-runtime';

/** Authorization and CSRF are supplied by the shared protected API assembly. */
export function registerToolRoutes(server: FastifyInstance, tools: ToolRuntime): void {
  const id = Type.String({ minLength: 1, maxLength: 160 });
  server.post<{ Params: { id: string; toolId: string }; Body: ToolDecisionInput }>(
    '/api/sessions/:id/tools/:toolId/decision',
    {
      schema: {
        params: Type.Object({ id, toolId: id }, { additionalProperties: false }),
        body: ToolDecisionInputSchema,
        response: { 200: Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }) },
      },
    },
    (request) => {
      tools.decide(request.params.id, request.params.toolId, request.body);
      return { ok: true };
    },
  );
}
