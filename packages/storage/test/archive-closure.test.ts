import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FileOperationHostSchema, type FrozenSkill } from '@my-pi-harness/protocol/internal';
import {
  archiveClosure,
  archiveDependencies,
  collectArchiveRecord,
  mapArchiveRecord,
  requiredArchivePaths,
} from '../src/archives/closure';
import type { StoredSessionEvent } from '../src/sessions/session-jsonl';
import { projectImportAccess, sessionExecutionAccess } from '../src/sessions/import-access';
import { checked } from '../src/shared/validation';

const BLOB_HASH = 'a'.repeat(64);

function record(
  type: string,
  data: Record<string, unknown>,
  privateData: Record<string, unknown> | null = null,
  seq = 1,
): StoredSessionEvent {
  return {
    event: {
      version: 1,
      eventId: 'event-' + seq,
      sessionId: 'session',
      runId: null,
      seq,
      at: seq,
      type,
      data,
    },
    privateData,
  };
}

function imageReference(bytes: number, seq = 1): StoredSessionEvent {
  return record(
    'file.operation.prepared',
    {
      operationId: 'file-op-' + seq,
      action: 'write',
      targetChangeId: null,
      workspaceId: 'workspace',
      path: 'src/notes.md',
      branchId: 'branch',
      before: { exists: false },
      after: { exists: true, sha256: BLOB_HASH, bytes, mode: 0o644 },
      source: { kind: 'tool', toolCallId: 'tool-' + seq },
    },
    null,
    seq,
  );
}

function frozenSkill(pluginId: string): FrozenSkill {
  const resources = [
    { path: 'SKILL.md', hash: 'b'.repeat(64), size: 42, mediaType: 'text/markdown' },
    { path: 'scripts/inspect.py', hash: 'c'.repeat(64), size: 10, mediaType: 'text/x-python' },
  ];
  const name = 'shared-workflow';
  const description = 'Shared instructions';
  const content = 'Keep /old/profile and session.execution_bound in free text unchanged.';
  const allowedTools = ['read_file'];
  const contentHash = createHash('sha256')
    .update(JSON.stringify([name, description, content, allowedTools, resources]))
    .digest('hex');
  return {
    selection: { id: 'skill-' + pluginId, contentHash },
    authorization: { skillEpoch: 1, pluginId, pluginEpoch: 2, pluginGeneration: 'generation' },
    name,
    description,
    content,
    allowedTools,
    scope: 'plugin',
    source: 'plugin',
    resources,
    resourceDirectory: '/old/profile/snapshots/' + contentHash,
  };
}

describe('archive resource closure and host metadata mapping', () => {
  it('rejects conflicting lengths for one immutable blob instead of trusting the last reference', () => {
    const closure = archiveClosure();
    collectArchiveRecord(closure, imageReference(10));
    expect(() => {
      collectArchiveRecord(closure, imageReference(11, 2));
    }).toThrow('conflicting lengths');
    expect(closure.blobs.get(BLOB_HASH)).toBe(10);
  });

  it('deduplicates identical byte references without dropping distinct plugin provenance', () => {
    const closure = archiveClosure();
    collectArchiveRecord(closure, imageReference(10));
    collectArchiveRecord(closure, imageReference(10, 2));
    const first = frozenSkill('first-plugin');
    const second = frozenSkill('second-plugin');
    expect(first.selection.contentHash).toBe(second.selection.contentHash);
    collectArchiveRecord(closure, record('run.tools_loaded', {}, { skills: [first] }, 3));
    collectArchiveRecord(
      closure,
      record('run.tools_loaded', {}, { inheritedSkillBindings: [second] }, 4),
    );
    expect(closure.skills.size).toBe(1);
    expect(archiveDependencies(closure, null).plugins).toEqual(['first-plugin', 'second-plugin']);
    expect(requiredArchivePaths(closure)).toEqual(
      new Set([
        'session.jsonl',
        'blobs/' + BLOB_HASH + '.blob',
        'skills/' + first.selection.contentHash + '/SKILL.md',
        'skills/' + first.selection.contentHash + '/scripts/inspect.py',
      ]),
    );
  });

  it('relocates typed Skill directories without rewriting model text or unrelated private values', () => {
    const skill = frozenSkill('plugin');
    const original = record(
      'context.prepared',
      { system: 'Original /old/profile prose mentions session.imported literally.' },
      {
        skills: [skill],
        systemPrompt: 'Exact /old/profile text',
        other: { resourceDirectory: '/old/profile/unrelated' },
      },
    );
    const before = structuredClone(original);
    const mapped = mapArchiveRecord(original, '/managed/imported-resources', new Map());
    expect(mapped.event).toEqual(original.event);
    expect(mapped.privateData?.['systemPrompt']).toBe('Exact /old/profile text');
    expect(mapped.privateData?.['other']).toEqual({ resourceDirectory: '/old/profile/unrelated' });
    expect(mapped.privateData?.['skills']).toEqual([
      { ...skill, resourceDirectory: '/managed/imported-resources/' + skill.selection.contentHash },
    ]);
    expect(original).toEqual(before);
  });

  it('namespaces imported file metadata and marks it read-only without changing its original path or text', () => {
    const original = imageReference(10);
    original.privateData = {
      fileOperationHost: {
        requestHash: 'd'.repeat(64),
        targetKey: 'e'.repeat(64),
        rootIdentity: { device: '1', inode: '2' },
        parentIdentity: { device: '1', inode: '3' },
        expectedRevision: 27,
        local: true,
      },
      text: 'Original /old/profile source remains text',
    };
    const mapped = mapArchiveRecord(original, '/managed/resources', new Map());
    const metadata = checked(FileOperationHostSchema, mapped.privateData?.['fileOperationHost']);
    expect(metadata.local).toBe(false);
    expect(metadata.targetKey).not.toBe('e'.repeat(64));
    expect(metadata.rootIdentity).toEqual({ device: '1', inode: '2' });
    expect(mapped.event).toEqual(original.event);
    expect(mapped.privateData?.['text']).toBe('Original /old/profile source remains text');
    expect(original.privateData['fileOperationHost']).toMatchObject({
      local: true,
      expectedRevision: 27,
    });
  });

  it('keeps a new import unbound under its current owner when old seals and binding events are replayed', () => {
    const db = new Database(':memory:');
    try {
      db.exec(
        "CREATE TABLE sessions(id TEXT PRIMARY KEY,archived INTEGER); INSERT INTO sessions VALUES('session',0); CREATE TABLE session_import_access(session_id TEXT PRIMARY KEY,imported_through_seq INTEGER,bound INTEGER,owner_user_id TEXT,data TEXT);",
      );
      const current = record(
        'session.imported',
        { operationId: 'new-import', archiveSha256: BLOB_HASH, importedThroughSeq: 10 },
        { importOwner: { userId: 'current-owner' } },
        20,
      );
      projectImportAccess(db, current.event, current.privateData ?? undefined);
      const oldSeal = record(
        'session.imported',
        { operationId: 'old-import', archiveSha256: 'b'.repeat(64), importedThroughSeq: 2 },
        { importOwner: { userId: 'old-owner' } },
        3,
      );
      const oldBinding = record(
        'session.execution_bound',
        {
          providerId: 'old-provider',
          modelId: 'old-model',
          thinkingLevel: 'off',
          workspaceId: 'old-workspace',
        },
        null,
        4,
      );
      for (const original of [oldSeal, oldBinding]) {
        const mapped = mapArchiveRecord(original, '/managed/resources', new Map());
        projectImportAccess(db, mapped.event, mapped.privateData ?? undefined);
      }
      expect(sessionExecutionAccess(db, 'session')).toEqual({
        importedThroughSeq: 10,
        bound: false,
      });
      expect(
        db
          .prepare('SELECT owner_user_id FROM session_import_access WHERE session_id=?')
          .get('session'),
      ).toEqual({ owner_user_id: 'current-owner' });
    } finally {
      db.close();
    }
  });
});
