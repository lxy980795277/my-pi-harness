import { createHash } from 'node:crypto';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { RuntimeError } from './errors.js';
import type { ToolSource } from '@my-pi-harness/protocol';
import type { FrozenMcpTool } from './external-tools.js';

export type RunToolSource = ToolSource;

export interface RunToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: TSchema;
}

export interface RunToolSelection {
  readonly source: RunToolSource;
  readonly definition: RunToolDefinition;
  readonly external?: FrozenMcpTool;
}

export interface RunToolRecord extends RunToolSelection {
  readonly fingerprint: string;
}

/** Freeze cloned schemas without discarding TypeBox's non-enumerable metadata. */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key));
    Object.freeze(value);
  }
  return value;
}

function fingerprint(selection: RunToolSelection): string {
  const json = JSON.stringify(selection, (_key: string, value: unknown): unknown => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const entries = Object.entries(value);
    entries.sort(([left], [right]) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    return Object.fromEntries(entries);
  });
  return createHash('sha256').update(json).digest('hex');
}

/** One accepted Run's definitions and executable sources; order is model-visible. */
export class RunToolset {
  public readonly records: readonly RunToolRecord[];
  public readonly definitions: readonly RunToolDefinition[];
  readonly #routes = new Map<string, RunToolRecord>();

  public constructor(selections: readonly RunToolSelection[]) {
    const records: RunToolRecord[] = [];
    for (const selection of selections) {
      const name = selection.definition.name;
      if (this.#routes.has(name))
        throw new RuntimeError('TOOL_NAME_CONFLICT', `工具名称重复：${name}`);
      const frozen = freeze(Value.Clone(selection));
      const digest = frozen.external
        ? frozen.external.selection.definitionFingerprint
        : fingerprint(frozen);
      const record = Object.freeze({ ...frozen, fingerprint: digest });
      records.push(record);
      this.#routes.set(name, record);
    }
    this.records = Object.freeze(records);
    this.definitions = Object.freeze(records.map(({ definition }) => definition));
    Object.freeze(this);
  }

  /** Resolve only tools accepted for this Run, never a mutable global catalog. */
  public require(name: string): RunToolRecord {
    const record = this.#routes.get(name);
    if (record === undefined)
      throw new RuntimeError('TOOL_NOT_AVAILABLE', `本次运行未提供工具：${name}`);
    return record;
  }
}
