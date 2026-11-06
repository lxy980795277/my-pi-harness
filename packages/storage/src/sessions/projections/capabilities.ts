import { and, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { Type } from 'typebox';
import {
  FrozenSkillSchema,
  SkillCandidatesSchema,
  FrozenMcpToolSchema,
  ToolSourceSchema,
  ToolDiscoveryDiagnosticSchema,
  type HarnessEvent,
  type FrozenSkill,
  type SkillCandidate,
} from '@my-pi-harness/protocol';
import { checked } from '../../shared/validation';
import { StorageError } from '../../shared/errors';
import * as schema from '../../sqlite/schema';
import { CapabilityLoadSchema, InputIdSchema, QueueRequestSchema } from '../event-validation';

const definition = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown()),
});
const record = Type.Object(
  {
    definition,
    source: ToolSourceSchema,
    fingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    external: Type.Optional(FrozenMcpToolSchema),
  },
  { additionalProperties: false },
);
const nativeRecord = Type.Object(
  {
    definition,
    source: Type.Union([
      Type.Object({ kind: Type.Literal('session') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('workspace') }, { additionalProperties: false }),
    ]),
    fingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { additionalProperties: false },
);
const privateLoad = Type.Object(
  {
    version: Type.Literal(1),
    revision: Type.Integer({ minimum: 2 }),
    tools: Type.Array(record, { maxItems: 128 }),
    skills: Type.Array(FrozenSkillSchema, { maxItems: 16 }),
  },
  { additionalProperties: false },
);
const accepted = Type.Object({
  tools: Type.Array(definition),
  toolSources: Type.Array(
    Type.Object({ name: Type.String(), source: ToolSourceSchema, fingerprint: Type.String() }),
  ),
  mcpCandidates: Type.Optional(Type.Array(FrozenMcpToolSchema, { maxItems: 512 })),
  mcpBindings: Type.Optional(Type.Array(FrozenMcpToolSchema, { maxItems: 16 })),
  nativeCandidates: Type.Array(nativeRecord, { maxItems: 128 }),
  skillCandidates: SkillCandidatesSchema,
  skills: Type.Optional(Type.Array(FrozenSkillSchema, { maxItems: 16 })),
  discoveryDiagnostics: Type.Optional(Type.Array(ToolDiscoveryDiagnosticSchema, { maxItems: 512 })),
});
function requirePrivateData(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (value === null || value === undefined)
    throw new StorageError('INVALID_EVENT', 'Capability changes require private definitions');
  return value;
}

function skillCandidate(skill: FrozenSkill): SkillCandidate {
  return {
    selection: skill.selection,
    authorization: skill.authorization,
    name: skill.name,
    description: skill.description,
    scope: skill.scope,
    source: skill.source,
  };
}

function consumedSkillCandidates(
  db: BetterSQLite3Database<typeof schema>,
  sessionId: string,
  runId: string,
): SkillCandidate[] {
  const metadata = [];
  const consumed = db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.sessionId, sessionId),
        eq(schema.events.runId, runId),
        eq(schema.events.type, 'queue.consumed'),
      ),
    )
    .all();
  for (const input of consumed) {
    const { inputId } = checked(InputIdSchema, input.data);
    const source = db
      .select({ privateData: schema.events.privateData })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.sessionId, sessionId),
          inArray(schema.events.type, ['queue.added', 'queue.updated']),
          lt(schema.events.seq, input.seq),
          isNotNull(schema.events.privateData),
          sql`json_extract(${schema.events.data}, '$.id') = ${inputId}`,
        ),
      )
      .orderBy(desc(schema.events.seq))
      .limit(1)
      .get();
    if (!source)
      throw new StorageError('INVALID_EVENT', 'Consumed input has no accepted Skill metadata');
    metadata.push(checked(QueueRequestSchema, source.privateData));
  }
  return metadata.flatMap((input) => [
    ...input.skillCandidates,
    ...input.skillBindings.map(skillCandidate),
    ...input.mentionedSkillBindings.map(skillCandidate),
    ...input.inheritedSkillBindings.map(skillCandidate),
  ]);
}

/** New model-visible tools must remain inside the accepted immutable candidate catalog. */
export function projectCapabilityLoad(
  db: BetterSQLite3Database<typeof schema>,
  event: HarnessEvent,
  privateData?: Record<string, unknown>,
): void {
  const data = checked(CapabilityLoadSchema, event.data);
  const payload = checked(privateLoad, requirePrivateData(privateData));
  const run =
    event.runId === null
      ? undefined
      : db.select().from(schema.runs).where(eq(schema.runs.id, event.runId)).get();
  if (!run || run.sessionId !== event.sessionId || run.data.status !== 'running')
    throw new StorageError('INVALID_EVENT', 'Capability change requires its active Run');
  const acceptance = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.runId, run.id), eq(schema.events.type, 'run.accepted')))
    .get();
  if (!acceptance)
    throw new StorageError('INVALID_EVENT', 'Capability change has no accepted input');
  const frozen = checked(accepted, requirePrivateData(acceptance.privateData));
  const previous = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.runId, run.id), eq(schema.events.type, 'run.tools_loaded')))
    .orderBy(desc(schema.events.seq))
    .limit(1)
    .get();
  const previousPayload = previous
    ? checked(privateLoad, requirePrivateData(previous.privateData))
    : undefined;
  const previousRevision = previousPayload?.revision ?? 1;
  if (
    data.revision !== previousRevision + 1 ||
    payload.revision !== data.revision ||
    JSON.stringify(data.names) !==
      JSON.stringify(payload.tools.map((tool) => tool.definition.name)) ||
    JSON.stringify(data.skills) !==
      JSON.stringify(payload.skills.map((skill) => skill.selection)) ||
    new Set(payload.skills.map((skill) => skill.selection.id)).size !== payload.skills.length
  )
    throw new StorageError(
      'INVALID_EVENT',
      'Capability revision or public identities do not match its private definitions',
    );
  const initial = new Map(frozen.tools.map((tool) => [tool.name, tool]));
  for (const tool of payload.tools) {
    if (tool.source.kind === 'mcp') {
      const source = tool.source;
      const candidate = frozen.mcpCandidates?.find(
        (item) =>
          item.selection.serverId === source.serverId &&
          item.selection.serverRevision === source.serverRevision &&
          item.selection.remoteToolName === source.remoteToolName &&
          item.selection.definitionFingerprint === tool.fingerprint,
      );
      const initialSource = frozen.toolSources.find(
        (item) =>
          item.name === tool.definition.name &&
          item.fingerprint === tool.fingerprint &&
          JSON.stringify(item.source) === JSON.stringify(source),
      );
      if (!candidate && !initialSource)
        throw new StorageError(
          'INVALID_EVENT',
          'Loaded tool is outside the accepted candidate catalog',
        );
      const original =
        candidate ??
        frozen.mcpBindings?.find(
          (item) =>
            item.selection.serverId === source.serverId &&
            item.selection.serverRevision === source.serverRevision &&
            item.selection.remoteToolName === source.remoteToolName &&
            item.selection.definitionFingerprint === tool.fingerprint,
        );
      if (!original || JSON.stringify(tool.external) !== JSON.stringify(original))
        throw new StorageError(
          'INVALID_EVENT',
          'Loaded tool cannot replace its frozen executable authorization',
        );
      const expected = candidate?.definition ?? initial.get(tool.definition.name);
      if (JSON.stringify(expected) !== JSON.stringify(tool.definition))
        throw new StorageError('INVALID_EVENT', 'Loaded tool cannot replace its frozen schema');
    } else {
      const initialSource = frozen.toolSources.find((item) => item.name === tool.definition.name);
      const candidate = frozen.nativeCandidates.find(
        (item) => item.definition.name === tool.definition.name,
      );
      const expected = initial.get(tool.definition.name) ?? candidate?.definition;
      const source = initialSource?.source ?? candidate?.source;
      const fingerprint = initialSource?.fingerprint ?? candidate?.fingerprint;
      if (
        !expected ||
        JSON.stringify(expected) !== JSON.stringify(tool.definition) ||
        JSON.stringify(tool.source) !== JSON.stringify(source) ||
        tool.fingerprint !== fingerprint ||
        tool.external !== undefined
      )
        throw new StorageError('INVALID_EVENT', 'Loaded native tool was not accepted');
    }
  }
  const previousTools =
    previousPayload?.tools ??
    frozen.toolSources.map((tool) => ({
      definition: { name: tool.name },
      source: tool.source,
      fingerprint: tool.fingerprint,
    }));
  for (const prior of previousTools)
    if (
      !payload.tools.some(
        (tool) =>
          tool.definition.name === prior.definition.name && tool.fingerprint === prior.fingerprint,
      )
    )
      throw new StorageError('INVALID_EVENT', 'Loading cannot silently remove a visible tool');
  const previousSkills = previousPayload?.skills ?? frozen.skills ?? [];
  for (const skill of previousSkills)
    if (
      !payload.skills.some((item) => {
        const { resourceDirectory: previousDirectory, ...previousContent } = skill;
        const { resourceDirectory: nextDirectory, ...nextContent } = item;
        return (
          isDeepStrictEqual(previousContent, nextContent) &&
          (previousPayload === undefined ||
            previousDirectory === undefined ||
            previousDirectory === nextDirectory)
        );
      })
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Loading cannot replace frozen Skill instructions or authority',
      );
  const additions = payload.skills.filter(
    (skill) => !previousSkills.some((previous) => previous.selection.id === skill.selection.id),
  );
  if (additions.length > 0) {
    const candidates = [
      ...frozen.skillCandidates,
      ...consumedSkillCandidates(db, event.sessionId, run.id),
    ];
    for (const skill of additions)
      if (!candidates.some((candidate) => isDeepStrictEqual(candidate, skillCandidate(skill))))
        throw new StorageError('INVALID_EVENT', 'Loaded Skill was not accepted for this Run');
  }
}

export function currentCapabilityRevision(
  db: BetterSQLite3Database<typeof schema>,
  runId: string,
): number {
  const row = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.runId, runId), eq(schema.events.type, 'run.tools_loaded')))
    .orderBy(desc(schema.events.seq))
    .limit(1)
    .get();
  return row ? checked(CapabilityLoadSchema, row.data).revision : 1;
}
