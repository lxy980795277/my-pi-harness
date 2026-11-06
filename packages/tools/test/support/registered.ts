import { Value } from 'typebox/value';
import { canonicalWorkspace } from '@my-pi-harness/sandbox';
import {
  nativeTool,
  ToolError,
  type WorkspaceToolContext,
  type ToolResult,
  type ToolPolicy,
  type WebFetchGatewayAccess,
} from '../../src/index.js';

export function describeRegistered(name: string, args: Record<string, unknown>): ToolPolicy {
  const registration = nativeTool(name);
  if (!registration || !Value.Check(registration.definition.parameters, args))
    throw new ToolError('INVALID_ARGUMENTS', 'Invalid arguments');
  return registration.policy(args, false);
}
/** Tests exercise the registered boundary rather than maintaining another production dispatcher. */
export async function executeRegistered(
  name: string,
  args: Record<string, unknown>,
  context: WorkspaceToolContext & {
    skillGateway?: WebFetchGatewayAccess;
  },
): Promise<ToolResult> {
  context.signal.throwIfAborted();
  describeRegistered(name, args);
  const registration = nativeTool(name);
  if (!registration) throw new ToolError('UNKNOWN_TOOL', 'Unknown tool');
  if (context.readOnly && registration.policy(args, true).mutating)
    throw new ToolError('READ_ONLY', 'Read only');
  return registration.bind({
    owner: { sessionId: 'session', runId: 'run', taskId: null },
    readOnly: context.readOnly,
    ...(context.skillGateway ? { skillGateway: context.skillGateway } : {}),
    workspace: async () => ({ ...context, workspaceRoot: await canonicalWorkspace(context) }),
  })(args, { toolCallId: 'fixture', signal: context.signal });
}
