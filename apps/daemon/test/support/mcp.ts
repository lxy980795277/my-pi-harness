import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import type {
  McpCallInput,
  McpCatalog,
  McpConnectionBinding,
  McpLaunchInput,
  McpLease,
  McpDiscoveredTool,
} from '@my-pi-harness/integrations';
import type { McpManager } from '../../src/features/mcp/types.js';

/** Controllable protocol adapter for management tests; integration tests own actual SDK bytes. */
export function mcpManagerFixture(): {
  manager: McpManager;
  state: {
    starts: number;
    active: number;
    invalidated: string[];
    bindings: McpConnectionBinding[];
    calls: McpCallInput[];
    closed: boolean;
  };
  tool: McpDiscoveredTool;
} {
  const state = {
    starts: 0,
    active: 0,
    invalidated: [] as string[],
    bindings: [] as McpConnectionBinding[],
    calls: [] as McpCallInput[],
    closed: false,
  };
  const tool = {
    remoteToolName: 'echo',
    description: 'Echo fixture text',
    definitionFingerprint: 'b'.repeat(64),
    definition: {
      name: 'echo',
      inputSchema: {
        type: 'object' as const,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    parameters: Type.Object({ text: Type.String() }, { additionalProperties: false }),
    supported: true,
    unavailableReason: null,
  };
  const catalog: McpCatalog = { tools: [tool] };
  const manager: McpManager = {
    previewLaunch(input: McpLaunchInput) {
      const secretNames = new Set(
        input.secretDescriptors.map((binding) => binding.environmentName),
      );
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            ...input,
            environment: Object.fromEntries(
              Object.entries(input.environment).filter(([key]) => !secretNames.has(key)),
            ),
          }),
        )
        .digest('hex');
      return Promise.resolve({
        launch: {
          ...input,
          argumentIdentities: [],
          programIdentity: { device: 1, inode: 1, size: 1, modifiedMs: 1 },
        },
        startupFingerprint: fingerprint,
      });
    },
    hasActiveLeases() {
      return state.active > 0;
    },
    discover(binding) {
      state.starts += 1;
      state.bindings.push(binding);
      return Promise.resolve(catalog);
    },
    acquire(binding) {
      state.starts += 1;
      state.active += 1;
      state.bindings.push(binding);
      let released = false;
      const lease: McpLease = {
        catalog,
        async call(input) {
          state.calls.push(input);
          await input.beforeDispatch();
          return {
            kind: 'known',
            isError: false,
            content: [{ type: 'text', text: 'fixture result' }],
            summary: 'fixture result',
          };
        },
        release() {
          if (!released) {
            released = true;
            state.active -= 1;
          }
          return Promise.resolve();
        },
      };
      return Promise.resolve(lease);
    },
    invalidateServer(id) {
      state.invalidated.push(id);
      return Promise.resolve();
    },
    close() {
      state.closed = true;
      return Promise.resolve();
    },
  };
  return { manager, state, tool };
}
