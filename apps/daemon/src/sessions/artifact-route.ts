import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { OfficeArtifactSchema } from '@my-pi-harness/protocol';
import { RuntimeError, type SessionRuntime } from '@my-pi-harness/agent-runtime';
import type { ProfileStore } from '@my-pi-harness/storage';
import { ExecutionError, openRegular, workspacePath } from '@my-pi-harness/execution';
import type { FastifyInstance } from 'fastify';
import type { WorkspaceService } from '../workspaces/service.js';

const outputTools = new Set([
  'office_docx',
  'office_pdf',
  'office_xlsx',
  'office_pptx',
  'office_render',
]);
const mime: Readonly<Record<string, string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const resultSchema = Type.Object(
  { artifact: OfficeArtifactSchema, report: Type.Unknown() },
  { additionalProperties: false },
);

/** Download only a completed native Office tool's exact published bytes, never a client-supplied path. */
export function registerOfficeArtifactRoute(
  server: FastifyInstance,
  runtime: Pick<SessionRuntime, 'getSessionSummary'>,
  store: Pick<ProfileStore, 'getVisibleTool'>,
  workspaces: Pick<WorkspaceService, 'requireAvailable'>,
): void {
  const active = new Set<AbortController>();
  const settlements = new Set<Promise<void>>();
  let closing = false;
  server.addHook('preClose', async () => {
    closing = true;
    for (const controller of active) controller.abort();
    await Promise.all(settlements);
  });
  server.get<{ Params: { id: string; toolId: string } }>(
    '/api/sessions/:id/tools/:toolId/artifact',
    {
      schema: {
        params: Type.Object(
          {
            id: Type.String({ minLength: 1, maxLength: 160 }),
            toolId: Type.String({ minLength: 1, maxLength: 160 }),
          },
          { additionalProperties: false },
        ),
        querystring: Type.Object({}, { additionalProperties: false }),
        response: { 200: Type.String({ description: 'Exact published Office file bytes' }) },
      },
    },
    async (request, reply) => {
      if (closing) throw new RuntimeError('OFFICE_ARTIFACT_CLOSED', '产物服务正在关闭。');
      const session = runtime.getSessionSummary(request.params.id);
      const tool = store.getVisibleTool(session.id, request.params.toolId);
      if (
        !tool ||
        tool.status !== 'completed' ||
        !outputTools.has(tool.name) ||
        tool.binding.kind !== 'accepted' ||
        tool.binding.source.kind !== 'workspace' ||
        tool.result === null ||
        session.workspaceId === null
      )
        throw new RuntimeError('OFFICE_ARTIFACT_NOT_FOUND', '此工具没有可下载的办公产物。');
      let value: unknown;
      try {
        value = JSON.parse(tool.result);
      } catch {
        throw new RuntimeError('OFFICE_ARTIFACT_NOT_FOUND', '产物记录无效。');
      }
      if (
        !Value.Check(resultSchema, value) ||
        extname(value.artifact.path).toLowerCase() !== `.${value.artifact.format}`
      )
        throw new RuntimeError('OFFICE_ARTIFACT_NOT_FOUND', '产物记录无效。');
      const artifact = value.artifact;
      const controller = new AbortController();
      active.add(controller);
      let settle = (): void => undefined;
      const settlement = new Promise<void>((resolve) => {
        settle = resolve;
      });
      settlements.add(settlement);
      const abort = (): void => controller.abort();
      const closed = (): void => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      request.raw.once('aborted', abort);
      reply.raw.once('close', closed);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      try {
        const workspace = await workspaces.requireAvailable(session.workspaceId);
        const path = await workspacePath(workspace.rootPath, artifact.path, false);
        const file = await openRegular(path, 33_554_432);
        let bytes: Buffer;
        try {
          bytes = await file.readFile({ signal });
        } finally {
          await file.close();
        }
        signal.throwIfAborted();
        if (
          bytes.length !== artifact.bytes ||
          createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
        )
          throw new RuntimeError(
            'OFFICE_ARTIFACT_CONFLICT',
            '文件在生成后已改变，请重新检查并生成产物。',
          );
        const fileName = encodeURIComponent(basename(artifact.path)).replaceAll("'", '%27');
        return reply
          .type(mime[artifact.format] ?? 'application/octet-stream')
          .header(
            'Content-Disposition',
            `attachment; filename="artifact.${artifact.format}"; filename*=UTF-8''${fileName}`,
          )
          .header('Content-Length', bytes.length)
          .header('Cache-Control', 'no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .send(bytes);
      } catch (cause) {
        if (cause instanceof ExecutionError)
          throw new RuntimeError(
            'OFFICE_ARTIFACT_UNAVAILABLE',
            '产物文件不可用或不在当前工作区。',
            { cause },
          );
        throw cause;
      } finally {
        request.raw.off('aborted', abort);
        reply.raw.off('close', closed);
        active.delete(controller);
        settle();
        settlements.delete(settlement);
      }
    },
  );
}
