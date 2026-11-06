import { Type, type Static, type TSchema } from 'typebox';
import type { Artifact, ToolSource } from '@my-pi-harness/protocol';
import type { ToolContext } from './tool-context';

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  summary: string;
  content: ToolContent[];
  diff?: string;
  artifacts?: Artifact[];
}
export interface ToolPolicy {
  summary: string;
  approvalRequired: boolean;
  mutating: boolean;
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: TSchema;
}
export interface ToolAvailability {
  workspace: boolean;
  work: boolean;
  skills: boolean;
  skillDirectory: boolean;
  agents: boolean;
  canSpawn: boolean;
  images: boolean;
  platform: NodeJS.Platform;
}
export interface ToolInvocation {
  toolCallId: string;
  signal: AbortSignal;
}
/** Executable functions are bound to one Run and never serialized with accepted declarations. */
export interface ToolRegistration {
  readonly definition: ToolDefinition;
  readonly source: Extract<ToolSource, { kind: 'session' | 'workspace' }>;
  readonly loading: 'default' | 'on-demand';
  /** Supports the caller’s read-only capability ceiling; policy still classifies each invocation. */
  readonly readOnly: boolean;
  available(input: ToolAvailability): boolean;
  policy(args: Record<string, unknown>, readOnly: boolean): ToolPolicy;
  bind(
    ports: ToolContext,
  ): (args: Record<string, unknown>, invocation: ToolInvocation) => Promise<ToolResult>;
}
interface RegistrationInput<S extends TSchema> {
  name: string;
  description: string;
  parameters: S;
  scope: 'session' | 'workspace';
  loading: ToolRegistration['loading'];
  readOnly: boolean;
  available?(input: ToolAvailability): boolean;
  policy?(args: Static<S>, readOnly: boolean): ToolPolicy;
  execute(
    ports: ToolContext,
    args: Static<S>,
    invocation: ToolInvocation,
  ): ToolResult | Promise<ToolResult>;
}

/** Tool-level failures retain a stable diagnostic without coupling sandbox or transport errors. */
export class ToolError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ToolError';
  }
}

/** An assembly-owned catalog validates names once; executors are rebound for each Run. */
export class ToolRegistry {
  private readonly entries = new Map<string, ToolRegistration>();
  public constructor(registrations: readonly ToolRegistration[]) {
    for (const registration of registrations) {
      const name = registration.definition.name;
      if (this.entries.has(name))
        throw new ToolError('TOOL_NAME_CONFLICT', `工具名称重复：${name}`);
      this.entries.set(name, registration);
    }
  }
  public get(name: string): ToolRegistration | undefined {
    return this.entries.get(name);
  }
  public list(): readonly ToolRegistration[] {
    return [...this.entries.values()];
  }
}

/** Bind exposes both synchronous and asynchronous implementations as rejecting async executors; the caller validates JSON. */
export function completeToolRegistration<S extends TSchema>(
  input: RegistrationInput<S>,
): ToolRegistration {
  return {
    definition: { name: input.name, description: input.description, parameters: input.parameters },
    source: { kind: input.scope },
    loading: input.loading,
    readOnly: input.readOnly,
    available: (availability) =>
      (input.scope !== 'workspace' || availability.workspace) &&
      (input.available?.(availability) ?? true),
    policy: (args, readOnly) =>
      input.policy?.(args as Static<S>, readOnly) ?? {
        summary: input.name,
        approvalRequired: !input.readOnly,
        mutating: !input.readOnly,
      },
    bind: (ports) => async (args, invocation) =>
      input.execute(ports, args as Static<S>, invocation),
  };
}

/** Preserve each property's TypeBox type while rejecting undeclared object fields. */
export function strictObjectSchema<T extends Record<string, TSchema>>(
  properties: T,
): ReturnType<typeof Type.Object<T>> {
  return Type.Object(properties, { additionalProperties: false });
}
