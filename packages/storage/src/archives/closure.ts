import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import {
  ArtifactPublishedSchema,
  RunViewSchema,
  MessageViewSchema,
  QueueInputSchema,
  SessionSummarySchema,
  type SessionArchiveManifest,
} from '@my-pi-harness/protocol';
import {
  FrozenSkillSchema,
  FileOperationIntentSchema,
  FileOperationHostSchema,
  type FrozenSkill,
} from '@my-pi-harness/protocol/internal';
import type { StoredSessionEvent } from '../sessions/session-jsonl';
import { StorageError } from '../shared/errors';
import { checked } from '../shared/validation';
import { archivePath } from './files';

export interface ArchiveClosure {
  attachments: Set<string>;
  blobs: Map<string, number>;
  skills: Map<string, FrozenSkill>;
  providers: Map<string, Set<string>>;
  plugins: Set<string>;
  currentProviderId: string | null;
  currentModelId: string | null;
  workspaceId: string | null;
}
const skillsSchema = Type.Array(FrozenSkillSchema, { maxItems: 16 });
const skillFields = [
  'skills',
  'skillBindings',
  'mentionedSkillBindings',
  'inheritedSkillBindings',
] as const;

export function archiveClosure(): ArchiveClosure {
  return {
    attachments: new Set(),
    blobs: new Map(),
    skills: new Map(),
    providers: new Map(),
    plugins: new Set(),
    currentProviderId: null,
    currentModelId: null,
    workspaceId: null,
  };
}

export function frozenSkills(privateData: Record<string, unknown> | null): FrozenSkill[] {
  if (privateData === null) return [];
  return skillFields.flatMap((key) =>
    privateData[key] === undefined ? [] : checked(skillsSchema, privateData[key]),
  );
}

function provider(closure: ArchiveClosure, id: unknown, model: unknown): void {
  if (typeof id !== 'string' || typeof model !== 'string') return;
  const models = closure.providers.get(id) ?? new Set<string>();
  models.add(model);
  closure.providers.set(id, models);
}

function blobReference(closure: ArchiveClosure, sha256: string, bytes: number): void {
  const previous = closure.blobs.get(sha256);
  if (previous !== undefined && previous !== bytes)
    throw new StorageError(
      'ARCHIVE_INVALID',
      'Archive contains conflicting lengths for the same immutable blob',
    );
  closure.blobs.set(sha256, bytes);
}

/** Follow explicit references from every committed branch and child, never profile-wide resources. */
export function collectArchiveRecord(closure: ArchiveClosure, record: StoredSessionEvent): void {
  const { event, privateData } = record;
  if (event.type === 'session.created') {
    const session = checked(SessionSummarySchema, event.data['session']);
    provider(closure, session.providerId, session.modelId);
    closure.currentProviderId = session.providerId;
    closure.currentModelId = session.modelId;
    closure.workspaceId = session.workspaceId;
  } else if (event.type === 'run.accepted') {
    const run = checked(RunViewSchema, event.data['run']);
    provider(closure, run.providerId, run.modelId);
  } else if (event.type === 'model.request.started')
    provider(closure, event.data['providerId'], event.data['modelId']);
  if (
    event.type === 'session.configured' ||
    event.type === 'session.execution_bound' ||
    event.type === 'session.history_bound'
  ) {
    if (typeof event.data['providerId'] === 'string')
      closure.currentProviderId = event.data['providerId'];
    if (typeof event.data['modelId'] === 'string') closure.currentModelId = event.data['modelId'];
    if (event.data['workspaceId'] === null || typeof event.data['workspaceId'] === 'string')
      closure.workspaceId = event.data['workspaceId'];
    provider(closure, closure.currentProviderId, closure.currentModelId);
  }
  let attachmentIds: readonly string[] = [];
  if (event.type === 'message.started')
    attachmentIds = checked(MessageViewSchema, event.data).attachmentIds ?? [];
  else if (event.type === 'message.completed')
    attachmentIds = checked(MessageViewSchema, event.data['message']).attachmentIds ?? [];
  else if (event.type === 'queue.added' || event.type === 'queue.updated')
    attachmentIds = checked(QueueInputSchema, event.data).attachmentIds ?? [];
  else if (event.type === 'context.prepared' && Array.isArray(event.data['attachmentIds']))
    attachmentIds = checked(Type.Array(Type.String()), event.data['attachmentIds']);
  for (const id of attachmentIds) closure.attachments.add(id);
  if (event.type === 'artifact.published') {
    const { artifact } = checked(ArtifactPublishedSchema, event.data);
    blobReference(closure, artifact.sha256, artifact.bytes);
  }
  if (event.type === 'file.operation.prepared')
    for (const image of [
      checked(FileOperationIntentSchema, event.data).before,
      checked(FileOperationIntentSchema, event.data).after,
    ])
      if (image.exists) blobReference(closure, image.sha256, image.bytes);
  for (const skill of frozenSkills(privateData)) {
    if (skill.authorization.pluginId !== null) closure.plugins.add(skill.authorization.pluginId);
    const key = skill.selection.contentHash;
    const resources = skill.resources.map(({ path, hash, size, mediaType }) => ({
      path,
      hash,
      size,
      mediaType,
    }));
    const contentHash = createHash('sha256')
      .update(
        JSON.stringify([
          skill.name,
          skill.description,
          skill.content,
          skill.allowedTools,
          resources,
        ]),
      )
      .digest('hex');
    if (contentHash !== key)
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Frozen Skill content does not match its version hash',
      );
    const previous = closure.skills.get(key);
    if (
      previous !== undefined &&
      JSON.stringify(previous.resources) !== JSON.stringify(skill.resources)
    )
      throw new StorageError(
        'ARCHIVE_INVALID',
        'Frozen Skill resource identity changed within the archive',
      );
    for (const resource of skill.resources) archivePath(resource.path);
    closure.skills.set(key, skill);
  }
}

export function requiredArchivePaths(closure: ArchiveClosure): Set<string> {
  const paths = new Set<string>(['session.jsonl']);
  for (const id of closure.attachments) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id))
      throw new StorageError('ARCHIVE_INVALID', 'Archive attachment identifier is invalid');
    paths.add(`attachments/${id}.json`);
  }
  for (const hash of closure.blobs.keys()) paths.add(`blobs/${hash}.blob`);
  for (const [hash, skill] of closure.skills)
    for (const resource of skill.resources) paths.add(`skills/${hash}/${resource.path}`);
  return paths;
}

/** Relocate only typed host metadata; historical model inputs and free text are unchanged. */
export function mapArchiveRecord(
  record: StoredSessionEvent,
  resourcesRoot: string,
  revisions: Map<string, number>,
): StoredSessionEvent {
  const result = structuredClone(record);
  if (result.privateData !== null)
    for (const key of skillFields)
      if (result.privateData[key] !== undefined)
        result.privateData[key] = checked(skillsSchema, result.privateData[key]).map((skill) => ({
          ...skill,
          resourceDirectory: `${resourcesRoot}/${skill.selection.contentHash}`,
        }));
  if (result.event.type === 'session.imported') result.event.type = 'archive.history.imported';
  if (result.event.type === 'session.execution_bound') result.event.type = 'session.history_bound';
  if (result.event.type === 'file.operation.prepared') {
    const host = checked(FileOperationHostSchema, result.privateData?.['fileOperationHost']);
    const revision = revisions.get(host.targetKey) ?? 0;
    revisions.set(host.targetKey, revision + 1);
    const targetKey = createHash('sha256')
      .update(`imported:${result.event.sessionId}:${host.targetKey}`)
      .digest('hex');
    result.privateData = {
      ...result.privateData,
      fileOperationHost: { ...host, targetKey, expectedRevision: revision, local: false },
    };
  }
  return result;
}

export function archiveDependencies(
  closure: ArchiveClosure,
  workspace: SessionArchiveManifest['dependencies']['workspace'],
): SessionArchiveManifest['dependencies'] {
  return {
    providers: [...closure.providers].map(([providerId, models]) => ({
      providerId,
      modelIds: [...models],
    })),
    workspace,
    plugins: [...closure.plugins],
  };
}
