import { Type } from 'typebox';
import { RuntimeError, type SessionRuntime } from '@my-pi-harness/agent-runtime';
import type { ProfileStore } from '@my-pi-harness/storage';
import type { FastifyInstance } from 'fastify';

/** Download a committed root or child publication by ID from its immutable host snapshot. */
export function registerArtifactRoute(
  server: FastifyInstance,
  runtime: Pick<SessionRuntime, 'getSessionSummary'>,
  store: Pick<ProfileStore, 'getArtifact' | 'acquireArtifactDownload'>,
): void {
  let closing = false;
  const releases = new Set<() => void>();
  server.addHook('preClose', () => {
    closing = true;
    for (const release of releases) release();
    return Promise.resolve();
  });
  server.get<{ Params: { id: string; artifactId: string } }>(
    '/api/sessions/:id/artifacts/:artifactId',
    {
      schema: {
        params: Type.Object(
          {
            id: Type.String({ minLength: 1, maxLength: 160 }),
            artifactId: Type.String({ minLength: 1, maxLength: 160 }),
          },
          { additionalProperties: false },
        ),
        querystring: Type.Object({}, { additionalProperties: false }),
        response: { 200: Type.String({ description: 'Exact registered artifact bytes' }) },
      },
    },
    async (request, reply) => {
      if (closing) throw new RuntimeError('ARTIFACT_CLOSED', '产物服务正在关闭。');
      const session = runtime.getSessionSummary(request.params.id);
      const artifact = store.getArtifact(session.id, request.params.artifactId);
      if (artifact === undefined)
        throw new RuntimeError('ARTIFACT_NOT_FOUND', '产物不存在或不属于当前会话。');
      const lease = store.acquireArtifactDownload(session.id, artifact.id);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        releases.delete(release);
        request.raw.off('aborted', release);
        reply.raw.off('close', release);
        reply.raw.off('finish', release);
        lease.release();
      };
      releases.add(release);
      request.raw.once('aborted', release);
      reply.raw.once('close', release);
      reply.raw.once('finish', release);
      try {
        const fileName = encodeURIComponent(artifact.name).replaceAll("'", '%27');
        return reply
          .type(artifact.mediaType)
          .header(
            'Content-Disposition',
            `attachment; filename="artifact"; filename*=UTF-8''${fileName}`,
          )
          .header('Content-Length', lease.bytes.length)
          .header('Cache-Control', 'no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .send(lease.bytes);
      } catch (error) {
        release();
        throw error;
      }
    },
  );
}
