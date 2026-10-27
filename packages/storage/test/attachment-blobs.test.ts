import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { AttachmentContent } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { openProfileStore, sessionLogDirectory } from '../src/index.js';

const content: AttachmentContent = {
  attachment: {
    id: 'attachment',
    name: 'notes.txt',
    mediaType: 'text/plain',
    kind: 'text',
    byteLength: 14,
    preview: 'Frozen content',
    sourcePath: null,
    workspaceId: null,
    createdAt: 1,
  },
  text: 'Frozen content',
  imageData: null,
};
function blobPath(profile: string): string {
  const path = realpathSync(profile);
  return join(
    sessionLogDirectory(path, join(path, '.my-pi-harness')),
    'attachments',
    'attachment.json',
  );
}
describe('immutable attachment blobs', () => {
  it('rebuilds metadata without placing attachment body in SQLite and refuses to overwrite IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-blob-'));
    let store = await openProfileStore(directory);
    try {
      store.putAttachment(content);
      expect(() => store.putAttachment(content)).toThrow('already exists');
      const source = await readFile(blobPath(directory), 'utf8');
      expect(source).toContain('Frozen content');
      store.close();
      const database = new Database(join(directory, 'data.sqlite'));
      try {
        const row: unknown = database.prepare('SELECT data FROM attachments').get();
        expect(row).toEqual({ data: JSON.stringify(content.attachment) });
        database.prepare('DELETE FROM attachments').run();
      } finally {
        database.close();
      }
      store = await openProfileStore(directory);
      expect(store.getAttachment('attachment')).toEqual(content);
      expect(await readFile(blobPath(directory), 'utf8')).toBe(source);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a changed complete blob during reads and startup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-blob-integrity-'));
    const store = await openProfileStore(directory);
    try {
      store.putAttachment(content);
      const source = await readFile(blobPath(directory), 'utf8');
      await writeFile(blobPath(directory), source.replace('Frozen content', 'forged content'));
      expect(() => store.getAttachment('attachment')).toThrow('checksum');
      store.close();
      await expect(openProfileStore(directory)).rejects.toThrow('checksum');
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a missing blob required by a committed message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-blob-missing-'));
    const store = await openProfileStore(directory);
    try {
      store.putAttachment(content);
      store.createSession({
        id: 'session',
        branchId: 'main',
        title: 'Attachment',
        providerId: 'provider',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode: 'ask',
        at: 1,
      });
      store.append('session', [
        {
          type: 'run.accepted',
          runId: 'run',
          at: 2,
          data: {
            run: {
              id: 'run',
              sessionId: 'session',
              branchId: 'main',
              providerId: 'provider',
              modelId: 'model',
              status: 'running',
              createdAt: 2,
              finishedAt: null,
              error: null,
            },
            requestId: 'request',
          },
        },
        {
          type: 'message.started',
          runId: 'run',
          at: 2,
          data: {
            id: 'user',
            sessionId: 'session',
            branchId: 'main',
            runId: 'run',
            role: 'user',
            text: 'Read this',
            attachmentIds: ['attachment'],
            thinking: '',
            createdAt: 2,
            status: 'complete',
            stopReason: null,
          },
          privateData: { marker: 'codec' },
        },
      ]);
      store.close();
      await rm(blobPath(directory));
      await expect(openProfileStore(directory)).rejects.toThrow('attachment blob is missing');
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
