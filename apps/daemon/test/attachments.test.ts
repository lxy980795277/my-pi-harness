import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import { WorkspaceService } from '../src/workspaces/service.js';
import { AttachmentService } from '../src/attachments/service.js';

const fixtures: { directory: string; store: ProfileStore }[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-attachment-'));
  const profile = join(directory, 'profile');
  const root = join(directory, 'workspace');
  await mkdir(root);
  const store = await openProfileStore(profile);
  fixtures.push({ directory, store });
  const workspaces = new WorkspaceService(store, profile);
  const workspace = await workspaces.create({ rootPath: root, name: 'Files' });
  const attachments = new AttachmentService(store, workspaces, profile);
  return { root, profile, store, workspace, attachments };
}
afterEach(async () => {
  for (const { directory, store } of fixtures.splice(0)) {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

describe('frozen attachments', () => {
  it('extracts Office and RTF documents and rejects invalid archives or MIME combinations', async () => {
    const { attachments } = await fixture();
    const docxData =
      'UEsDBBQAAAAIABksUF3mdcR+0gAAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvVLDMAzHX8XnlasVGBh6SToAKzD0BXSOkvjw11luad++Sls6cIVR+n/8ZLebQ/BqT4Vdip1+NI3e9O32mImVKJE7Pdea1wBsZwrIJmWKooypBKwylgky2i+cCJ6a5hlsipViXdWlQ/ftK42481W9HWR9oRTyrNXLxbiwOo05e2exig77OPyirK4EI8mzh2eX+UEMGu4SFuVvwDX3Ic8ubiD1iaW+YxAXfKcywJDsLkjS/F9z5840js7SLb+05ZIsMbs4BW9uSkAXf+6H83f3J1BLAwQUAAAACAAZLFBdXzOVUpUAAAAHAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0Q+QJ0yMKCmXVi6Ii4QJW5T0TzkhNftycBAEQOjf//6LHfDw6/iRpyXGBS0jYSh70606lKD7JaURW2ErMCVkg6I2TjyOjcxUaibKbLXpY48Y9LmomfCnZR75E8DtqYYrQIebQvi/Ez0jx2naTF0jObqKZQfJ74aVdY8U1Fwj2zRvuOmsoB9h5sX+xdQSwMEFAAAAAgAGSxQXVabwWmMAAAAwQAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWOWw6CMBBFt9J0ARQ18YPwWIGLqGUEIjPTTAfB3Usx0Z9zMznJvVN3G87mBZImpsaeitJ2bb1WPYcFgdTsmlK1NnZUjZVzKYyAPhUcgXb3YEGv+ymDW1n6KBwgpYkGnN25LK8O/UQ2V965f+eMGZKh7e1ifkuBSWFTg16eILXLPlMOxoPfDvf/r/0AUEsBAhQDFAAAAAgAGSxQXeZ1xH7SAAAAiwEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACAAZLFBdXzOVUpUAAAAHAQAACwAAAAAAAAAAAAAAgAEDAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACAAZLFBdVpvBaYwAAADBAAAAEQAAAAAAAAAAAAAAgAHBAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAfAIAAAAA';
    const office = await attachments.upload({
      name: 'report.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: docxData,
    });
    const macro = await attachments.upload({
      name: 'report.docm',
      mediaType: 'application/vnd.ms-word.document.macroenabled.12',
      data: docxData,
    });
    expect(macro.kind).toBe('document');
    expect(office.kind).toBe('document');
    expect(attachments.get(office.id).text).toContain('M3 document context marker');
    const rtf = await attachments.upload({
      name: 'notes.rtf',
      mediaType: 'application/rtf',
      data: Buffer.from('{\\rtf1\\ansi M3 RTF context}').toString('base64'),
    });
    expect(attachments.get(rtf.id).text).toContain('M3 RTF context');
    await expect(
      attachments.upload({
        name: 'invalid.docx',
        mediaType: 'application/octet-stream',
        data: Buffer.from('PK-invalid').toString('base64'),
      }),
    ).rejects.toThrow();
    await expect(
      attachments.upload({
        name: 'invalid.docx',
        mediaType: 'text/plain',
        data: Buffer.from('text').toString('base64'),
      }),
    ).rejects.toThrow('不符');
  });

  it('stores text and signed image content privately and rejects malformed/type-mismatched data', async () => {
    const { attachments } = await fixture();
    const text = await attachments.upload({
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: Buffer.from('Useful context').toString('base64'),
    });
    expect(attachments.get(text.id).text).toBe('Useful context');
    const image = await attachments.upload({
      name: 'one.png',
      mediaType: 'image/png',
      data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'),
    });
    expect(attachments.get(image.id).imageData).not.toBeNull();
    for (const data of ['????', 'YQ', 'YQ==\n', 'YR=='])
      await expect(
        attachments.upload({ name: 'bad.txt', mediaType: 'text/plain', data }),
      ).rejects.toThrow('编码');
    await expect(
      attachments.upload({
        name: 'bad.png',
        mediaType: 'image/png',
        data: Buffer.from('not-image').toString('base64'),
      }),
    ).rejects.toThrow('不符');
    await expect(
      attachments.upload({
        name: 'bad.txt',
        mediaType: 'text/plain',
        data: Buffer.from([0xff]).toString('base64'),
      }),
    ).rejects.toThrow('UTF-8');
    await expect(
      attachments.upload({
        name: 'big.txt',
        mediaType: 'text/plain',
        data: Buffer.alloc(256_001, 97).toString('base64'),
      }),
    ).rejects.toThrow('256KB');
    await expect(
      attachments.upload({
        name: 'bad.svg',
        mediaType: 'image/svg+xml',
        data: Buffer.from('<svg/>').toString('base64'),
      }),
    ).rejects.toThrow('不符');
  });

  it('handles bounded large images and waits for PDF parsing to stop during close', async () => {
    const { attachments } = await fixture();
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    const image = await attachments.upload({
      name: 'large.png',
      mediaType: 'image/png',
      data: bytes.toString('base64'),
    });
    expect(image.byteLength).toBe(2 * 1024 * 1024);
    await expect(
      attachments.upload({
        name: 'too-large.png',
        mediaType: 'image/png',
        data: Buffer.concat([bytes, Buffer.from([0])]).toString('base64'),
      }),
    ).rejects.toThrow('2MiB');
    const parsing = attachments.upload({
      name: 'parsing.pdf',
      mediaType: 'application/pdf',
      data: Buffer.from('%PDF-1.7\ninvalid').toString('base64'),
    });
    const stopped = expect(parsing).rejects.toMatchObject({ code: 'CANCELLED' });
    await attachments.close();
    await stopped;
    await attachments.close();
    await expect(
      attachments.upload({ name: 'notes.txt', mediaType: 'text/plain', data: '' }),
    ).rejects.toThrow('已关闭');
  });

  it('freezes a selected range and blocks hidden secrets, traversal and links', async () => {
    const { root, profile, workspace, attachments } = await fixture();
    await writeFile(join(root, 'notes.txt'), 'first\nsecond\nthird');
    await writeFile(join(root, '.env'), 'SECRET');
    await symlink(join(profile, 'data.sqlite'), join(root, 'linked'));
    const reference = await attachments.reference({
      workspaceId: workspace.id,
      path: 'notes.txt',
      startLine: 2,
      endLine: 2,
    });
    await writeFile(join(root, 'notes.txt'), 'changed');
    expect(attachments.get(reference.id).text).toBe('second');
    expect(reference.sourcePath).toBe('notes.txt');
    expect(reference.workspaceId).toBe(workspace.id);
    expect(await attachments.listFiles(workspace.id)).toEqual(['notes.txt']);
    for (const path of ['.env', '../profile/data.sqlite', 'linked', '/tmp/escape'])
      await expect(attachments.reference({ workspaceId: workspace.id, path })).rejects.toThrow();
    await expect(
      attachments.reference({
        workspaceId: workspace.id,
        path: 'notes.txt',
        startLine: 3,
        endLine: 1,
      }),
    ).rejects.toThrow('行范围');
  });

  it('does not persist cancelled or invalid PDF uploads', async () => {
    const { attachments } = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      attachments.upload(
        {
          name: 'notes.txt',
          mediaType: 'text/plain',
          data: Buffer.from('text').toString('base64'),
        },
        controller.signal,
      ),
    ).rejects.toThrow('取消');
    await expect(
      attachments.upload({
        name: 'bad.pdf',
        mediaType: 'application/pdf',
        data: Buffer.from('invalid').toString('base64'),
      }),
    ).rejects.toThrow('PDF内容');
    await expect(
      attachments.upload({
        name: 'bad.pdf',
        mediaType: 'application/pdf',
        data: Buffer.from('%PDF-1.7\ninvalid').toString('base64'),
      }),
    ).rejects.toThrow();
  });
});

describe('attachment HTTP schemas', () => {
  it('rejects unknown upload fields and exposes content only through the dedicated route', async () => {
    const { attachments } = await fixture();
    const { default: Fastify } = await import('fastify');
    const { registerAttachmentRoutes } = await import('../src/attachments/routes.js');
    const { AttachmentSchema, AttachmentContentSchema } = await import('@my-pi-harness/protocol');
    const { Value } = await import('typebox/value');
    const server = Fastify({
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    registerAttachmentRoutes(server, attachments);
    try {
      const body = {
        name: 'notes.txt',
        mediaType: 'text/plain',
        data: Buffer.from('frozen content').toString('base64'),
      };
      const rejected = await server.inject({
        method: 'POST',
        url: '/api/attachments',
        payload: { ...body, extra: true },
      });
      expect(rejected.statusCode).toBe(400);
      const response = await server.inject({
        method: 'POST',
        url: '/api/attachments',
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      const attachment: unknown = response.json();
      if (!Value.Check(AttachmentSchema, attachment))
        throw new Error('Invalid attachment fixture response');
      expect(response.body).not.toContain('imageData');
      const metadata = await server.inject(`/api/attachments/${attachment.id}`);
      expect(metadata.json()).toEqual(attachment);
      expect(metadata.body).not.toContain('imageData');
      const content = await server.inject(`/api/attachments/${attachment.id}/content`);
      const result: unknown = content.json();
      if (!Value.Check(AttachmentContentSchema, result))
        throw new Error('Invalid content fixture response');
      expect(result.text).toBe('frozen content');
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/api/attachments/reference',
            payload: { workspaceId: 'id', path: 'notes', startLine: 0 },
          })
        ).statusCode,
      ).toBe(400);
      expect((await server.inject('/api/workspaces/id/files?extra=true')).statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });
});
