import type { ExecutionContent } from '@my-pi-harness/execution';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import type {
  FrozenSkill,
  ConnectionGrant,
  ConnectionOperationView,
} from '@my-pi-harness/protocol';
import type { ConnectionGatewayPort } from './connection-ports.js';
import type { EventInput } from './runtime-ports.js';
import type { RunToolDefinition, RunToolSelection } from './run-toolset.js';
import { RuntimeError } from './errors.js';

const object = { additionalProperties: false } as const;
const id = Type.String({ minLength: 1, maxLength: 160 });
export const CONNECTION_TOOL_DEFINITIONS: readonly RunToolDefinition[] = [
  {
    name: 'service_search',
    description:
      'Find connected service operations for active plugin Skills. This returns metadata only, never credentials or permission to call.',
    parameters: Type.Object({ query: Type.String({ maxLength: 200 }) }, object),
  },
  {
    name: 'request_service_access',
    description:
      'Ask the user for a short-lived Run grant binding one active plugin Skill, connected account and concrete service operations. Each subsequent write still obeys normal approval and Plan policy.',
    parameters: Type.Object(
      {
        skillId: id,
        connectionId: id,
        operations: Type.Array(id, { minItems: 1, maxItems: 30, uniqueItems: true }),
        ttlSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 900 })),
      },
      object,
    ),
  },
  {
    name: 'revoke_service_access',
    description: 'Revoke service access for this Run and stop it before further service calls.',
    parameters: Type.Object({}, object),
  },
];

function toolName(connectionId: string, operation: string): string {
  const account = createHash('sha256').update(connectionId).digest('hex').slice(0, 10);
  return `service_${account}_${operation.replaceAll('.', '_')}`;
}

interface ConnectionCapabilitiesOptions {
  runId: string;
  workspaceId: string | null;
  gateway: ConnectionGatewayPort;
  skills(): readonly FrozenSkill[];
  commit(events: readonly EventInput[]): void;
}

/** Service grants are explicit Run facts; callable definitions become visible on the next request. */
export class ConnectionCapabilities {
  private readonly staged = new Map<string, RunToolSelection>();
  private closed = false;
  public constructor(private readonly options: ConnectionCapabilitiesOptions) {}
  public has(name: string): boolean {
    return CONNECTION_TOOL_DEFINITIONS.some((tool) => tool.name === name);
  }
  public pending(): readonly RunToolSelection[] {
    return [...this.staged.values()];
  }
  public committed(): void {
    this.staged.clear();
  }
  public async execute(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ExecutionContent[]> {
    if (this.closed) throw new RuntimeError('SERVICE_GRANT_REVOKED', '本次运行的服务授权已撤销。');
    signal.throwIfAborted();
    if (name === 'revoke_service_access') {
      this.options.commit([
        { type: 'run.service_access_revoked', runId: this.options.runId, at: Date.now(), data: {} },
      ]);
      this.close();
      return [{ type: 'text' as const, text: '本次运行的服务授权已撤销，运行停止。' }];
    }
    const available = await this.options.gateway.catalog(
      this.options.workspaceId,
      this.options.skills(),
      signal,
    );
    if (name === 'service_search') {
      const words = String(args['query']).toLowerCase().split(/\s+/).filter(Boolean);
      const matches = available.filter((operation) =>
        words.every((word) =>
          `${operation.id} ${operation.name} ${operation.description} ${operation.app}`
            .toLowerCase()
            .includes(word),
        ),
      );
      return [
        {
          type: 'text' as const,
          text: JSON.stringify(
            matches.slice(0, 60).map(({ parameters: _parameters, ...metadata }) => metadata),
          ),
        },
      ];
    }
    if (name !== 'request_service_access')
      throw new RuntimeError('TOOL_NOT_AVAILABLE', '服务控制工具不存在。');
    const skill = this.options.skills().find((item) => item.selection.id === args['skillId']);
    if (!skill) throw new RuntimeError('SKILL_NOT_ACTIVE', '请先激活服务所属的插件Skill。');
    const connectionId = String(args['connectionId']);
    const operations = args['operations'];
    if (!Array.isArray(operations) || operations.some((operation) => typeof operation !== 'string'))
      throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '服务操作列表无效。');
    const selected: ConnectionOperationView[] = [];
    for (const operation of operations) {
      const found = available.find(
        (item) => item.connectionId === connectionId && item.id === operation,
      );
      if (!found)
        throw new RuntimeError('SERVICE_OPERATION_UNAVAILABLE', '请求的服务操作或连接不可用。');
      selected.push(found);
    }
    const ttl = typeof args['ttlSeconds'] === 'number' ? args['ttlSeconds'] : 300;
    const grant: ConnectionGrant = await this.options.gateway.freezeGrant(
      {
        runId: this.options.runId,
        skill,
        connectionId,
        operations: operations as string[],
        expiresAt: Date.now() + ttl * 1000,
      },
      signal,
    );
    this.options.commit([
      {
        type: 'run.service_access_granted',
        runId: this.options.runId,
        at: Date.now(),
        data: {
          grantId: grant.id,
          skillId: skill.selection.id,
          connectionId,
          operations: grant.operations,
          expiresAt: grant.expiresAt,
        },
        privateData: JSON.stringify({ grant, operations: selected }),
      },
    ]);
    for (const operation of selected) {
      const definition = {
        name: toolName(connectionId, operation.id),
        description: `${operation.name}. ${operation.description}`,
        parameters: operation.parameters,
      };
      this.staged.set(definition.name, {
        definition,
        source: { kind: 'connection', connectionId, grantId: grant.id, operation: operation.id },
        connection: { grant, operation },
      });
    }
    return [
      {
        type: 'text' as const,
        text: JSON.stringify({
          grantId: grant.id,
          expiresAt: grant.expiresAt,
          stagedForNextRequest: this.pending().map((tool) => ({
            name: tool.definition.name,
            operation: tool.source,
          })),
        }),
      },
    ];
  }
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.staged.clear();
    this.options.gateway.revokeRun(this.options.runId);
  }
}
