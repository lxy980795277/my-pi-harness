import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Type } from 'typebox';
import {
  FrozenSkillSchema,
  FrozenMcpToolSchema,
  ToolSourceSchema,
  ToolDiscoveryDiagnosticSchema,
  type HarnessEvent,
} from '@my-pi-harness/protocol';
import { checked } from '../../shared/validation.js';
import { StorageError } from '../../shared/errors.js';
import * as schema from '../../sqlite/schema.js';
import { CapabilityLoadSchema } from '../event-validation.js';

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
  discoveryDiagnostics: Type.Optional(Type.Array(ToolDiscoveryDiagnosticSchema, { maxItems: 512 })),
});
function requirePrivateData(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (value === null || value === undefined)
    throw new StorageError('INVALID_EVENT', 'Capability changes require private definitions');
  return value;
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
    JSON.stringify(data.skills) !== JSON.stringify(payload.skills.map((skill) => skill.selection))
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
          tool.definition.name === prior.definition.name && tool.fingerprint === prior.fingerprint,
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
  return row ? checked(CapabilityLoadSchema, row.data).revision : 1;
}
