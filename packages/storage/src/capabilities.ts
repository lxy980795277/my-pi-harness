import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Type } from 'typebox';
import {
  FrozenSkillSchema,
  FrozenMcpToolSchema,
  ConnectionGrantSchema,
  ConnectionOperationViewSchema,
  SkillSelectionsSchema,
  ToolSourceSchema,
  type HarnessEvent,
} from '@my-pi-harness/protocol';
import { checked } from './validation.js';
import { StorageError } from './errors.js';
import * as schema from './schema.js';

const definition = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown()),
});
const record = Type.Object({
  definition,
  source: ToolSourceSchema,
  fingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  external: Type.Optional(FrozenMcpToolSchema),
  connection: Type.Optional(
    Type.Object(
      { grant: ConnectionGrantSchema, operation: ConnectionOperationViewSchema },
      { additionalProperties: false },
    ),
  ),
});
const publicLoad = Type.Object(
  {
    revision: Type.Integer({ minimum: 2 }),
    names: Type.Array(Type.String(), { maxItems: 128, uniqueItems: true }),
    skills: SkillSelectionsSchema,
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
  workspaceCandidates: Type.Optional(Type.Array(definition)),
  skills: Type.Optional(Type.Array(FrozenSkillSchema, { maxItems: 16 })),
});
function parse(value: string | null): unknown {
  if (value === null)
    throw new StorageError('INVALID_EVENT', 'Capability changes require private definitions');
  try {
    return JSON.parse(value) as unknown;
  } catch (cause) {
    throw new StorageError('INVALID_RECORD', 'Capability audit is not valid JSON', { cause });
  }
}

/** New model-visible tools must remain inside the accepted immutable candidate catalog. */
export function projectCapabilityLoad(
  db: BetterSQLite3Database<typeof schema>,
  event: HarnessEvent,
  privateData?: string,
): void {
  const data = checked(publicLoad, event.data);
  const payload = checked(privateLoad, parse(privateData ?? null));
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
  const frozen = checked(accepted, parse(acceptance.privateData));
  const previous = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.runId, run.id), eq(schema.events.type, 'run.tools_loaded')))
    .orderBy(desc(schema.events.seq))
    .limit(1)
    .get();
  const previousPayload = previous ? checked(privateLoad, parse(previous.privateData)) : undefined;
  const previousRevision = previousPayload?.revision ?? 1;
  if (
    data.revision !== previousRevision + 1 ||
    payload.revision !== data.revision ||
    JSON.stringify(data.names) !==
      JSON.stringify(payload.tools.map((tool) => tool.definition.name)) ||
    JSON.stringify(data.skills) !== JSON.stringify(payload.skills.map((skill) => skill.selection))
  )
    throw new StorageError(
      'INVALID_EVENT',
      'Capability revision or public identities do not match its private definitions',
    );
  const initial = new Map(frozen.tools.map((tool) => [tool.name, tool]));
  for (const tool of payload.tools) {
    if (tool.source.kind === 'connection') {
      const source = tool.source;
      const grantEvent = db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.runId, run.id),
            eq(schema.events.type, 'run.service_access_granted'),
          ),
        )
        .all()
        .find((entry) => entry.data['grantId'] === source.grantId);
      if (!grantEvent || !tool.connection)
        throw new StorageError('INVALID_EVENT', 'Connection tool requires an explicit grant event');
      const grant = checked(serviceGrantPrivate, parse(grantEvent.privateData));
      const operation = grant.operations.find(
        (entry) => entry.id === source.operation && entry.connectionId === source.connectionId,
      );
      if (
        source.connectionId !== grant.grant.connectionId ||
        !grant.grant.operations.includes(source.operation) ||
        !operation ||
        JSON.stringify(tool.connection.grant) !== JSON.stringify(grant.grant) ||
        JSON.stringify(tool.connection.operation) !== JSON.stringify(operation) ||
        JSON.stringify(tool.definition.parameters) !== JSON.stringify(operation.parameters)
      )
        throw new StorageError(
          'INVALID_EVENT',
          'Connection tool differs from its approved operation or account',
        );
    } else if (tool.source.kind === 'mcp') {
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
      const expected =
        initial.get(tool.definition.name) ??
        frozen.workspaceCandidates?.find((item) => item.name === tool.definition.name);
      const initialSource = frozen.toolSources.find((item) => item.name === tool.definition.name);
      if (
        !expected ||
        JSON.stringify(expected) !== JSON.stringify(tool.definition) ||
        (initialSource !== undefined &&
          (JSON.stringify(tool.source) !== JSON.stringify(initialSource.source) ||
            tool.fingerprint !== initialSource.fingerprint)) ||
        (initialSource === undefined && tool.source.kind !== 'workspace')
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
          tool.definition.name === prior.definition.name &&
          (tool.fingerprint === prior.fingerprint ||
            (prior.source.kind === 'connection' &&
              tool.source.kind === 'connection' &&
              tool.source.connectionId === prior.source.connectionId &&
              tool.source.operation === prior.source.operation)),
      )
    )
      throw new StorageError('INVALID_EVENT', 'Loading cannot silently remove a visible tool');
  for (const skill of previousPayload?.skills ?? frozen.skills ?? [])
    if (!payload.skills.some((item) => JSON.stringify(item) === JSON.stringify(skill)))
      throw new StorageError(
        'INVALID_EVENT',
        'Loading cannot replace frozen Skill instructions or authority',
      );
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
  return row ? checked(publicLoad, row.data).revision : 1;
}

const serviceGrantPublic = Type.Object(
  {
    grantId: Type.String(),
    skillId: Type.String(),
    connectionId: Type.String(),
    operations: Type.Array(Type.String(), { minItems: 1, maxItems: 30, uniqueItems: true }),
    expiresAt: Type.Integer(),
  },
  { additionalProperties: false },
);
const serviceGrantPrivate = Type.Object(
  {
    grant: ConnectionGrantSchema,
    operations: Type.Array(ConnectionOperationViewSchema, { minItems: 1, maxItems: 30 }),
  },
  { additionalProperties: false },
);

/** A replayable grant contains its account, Skill version and finite operation definitions. */
export function projectServiceGrant(
  db: BetterSQLite3Database<typeof schema>,
  event: HarnessEvent,
  privateData?: string,
): void {
  const publicData = checked(serviceGrantPublic, event.data);
  const { grant, operations } = checked(serviceGrantPrivate, parse(privateData ?? null));
  const run =
    event.runId === null
      ? undefined
      : db.select().from(schema.runs).where(eq(schema.runs.id, event.runId)).get();
  if (
    !run ||
    run.sessionId !== event.sessionId ||
    run.data.status !== 'running' ||
    grant.runId !== run.id ||
    grant.id !== publicData.grantId ||
    grant.skillId !== publicData.skillId ||
    grant.connectionId !== publicData.connectionId ||
    grant.expiresAt !== publicData.expiresAt ||
    grant.expiresAt <= event.at ||
    grant.expiresAt > event.at + 900_000 ||
    JSON.stringify(grant.operations) !== JSON.stringify(publicData.operations) ||
    JSON.stringify(operations.map((operation) => operation.id)) !==
      JSON.stringify(grant.operations) ||
    operations.some(
      (operation) =>
        operation.connectionId !== grant.connectionId ||
        operation.accountId !== grant.accountId ||
        operation.serviceId !== grant.serviceId,
    )
  )
    throw new StorageError(
      'INVALID_EVENT',
      'Service grant does not match its active Run, account or operations',
    );
}
