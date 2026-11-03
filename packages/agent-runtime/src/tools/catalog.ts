import { OFFICE_TOOL_DEFINITIONS, TOOL_DEFINITIONS } from '@my-pi-harness/execution';
import { AGENT_TOOL_DEFINITIONS } from '../agents/definitions.js';
import { DISCOVERY_TOOL_DEFINITIONS, SKILL_TOOL_DEFINITIONS } from '../capabilities/definitions.js';
import { SESSION_TOOL_DEFINITIONS } from '../work/tools.js';
import type { RunToolDefinition } from './toolset.js';

export type NativeToolFamily = 'workspace' | 'web' | 'work' | 'capability' | 'agent';

export interface NativeToolDescriptor {
  readonly definition: RunToolDefinition;
  readonly source: { readonly kind: 'session' | 'workspace' };
  readonly family: NativeToolFamily;
  readonly loading: 'default' | 'on-demand';
  readonly readOnly: boolean;
}

const defaults = new Set(['ask_user', 'tool_search', 'load_skill', 'spawn_agent', 'wait_agents']);
const readOnlyWorkspace = new Set([
  'read_file',
  'list_files',
  'search_files',
  'office_inspect',
  'pdf_read_pages',
]);
const descriptors: readonly NativeToolDescriptor[] = [
  ...TOOL_DEFINITIONS.map(
    (definition): NativeToolDescriptor => ({
      definition,
      source: { kind: definition.name === 'web_fetch' ? 'session' : 'workspace' },
      family: definition.name === 'web_fetch' ? 'web' : 'workspace',
      loading: 'default',
      readOnly: readOnlyWorkspace.has(definition.name) || definition.name === 'web_fetch',
    }),
  ),
  ...OFFICE_TOOL_DEFINITIONS.map(
    (definition): NativeToolDescriptor => ({
      definition,
      source: { kind: 'workspace' },
      family: 'workspace',
      loading: 'on-demand',
      readOnly: readOnlyWorkspace.has(definition.name),
    }),
  ),
  ...(
    [
      [SESSION_TOOL_DEFINITIONS, 'work'],
      [[...DISCOVERY_TOOL_DEFINITIONS, ...SKILL_TOOL_DEFINITIONS], 'capability'],
      [AGENT_TOOL_DEFINITIONS, 'agent'],
    ] as const
  ).flatMap(([definitions, family]) =>
    definitions.map(
      (definition): NativeToolDescriptor => ({
        definition,
        source: { kind: 'session' },
        family,
        loading: defaults.has(definition.name) ? 'default' : 'on-demand',
        readOnly: true,
      }),
    ),
  ),
];
const catalog = new Map(descriptors.map((entry) => [entry.definition.name, entry]));

/** Native declarations, loading policy and executable family share one host-owned catalog. */
export function nativeTools(): readonly NativeToolDescriptor[] {
  return descriptors;
}

/** Resolve native metadata without confusing an external tool with a similarly named built-in. */
export function nativeTool(name: string): NativeToolDescriptor | undefined {
  return catalog.get(name);
}
