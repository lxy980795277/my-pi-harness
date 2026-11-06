import type {
  AgentLimits,
  AgentRole,
  AgentSettings,
  SessionSnapshot,
} from '@my-pi-harness/protocol';
import type { FrozenMcpTool } from '../tools/external';
import type { RunToolSelection } from '../tools/toolset';
import { nativeTool, type ToolRegistration } from '@my-pi-harness/tools';
import { RuntimeError } from '../errors';
import type { SpawnAgentInput } from '@my-pi-harness/tools';
import type { SubagentNode } from './types';

interface DelegationPolicy {
  role: AgentRole;
  limits: AgentLimits;
}

/** Resolve one child's accepted role and monotone limits before task creation. */
export function resolveDelegationPolicy(
  parent: SubagentNode,
  currentSettings: AgentSettings,
  input: SpawnAgentInput,
): DelegationPolicy {
  const tree = parent.tree;

  if (!currentSettings.enabled)
    throw new RuntimeError('AGENTS_DISABLED', '子 Agent 已停用，不能再创建任务。');
  const role = currentSettings.roles.find((entry) => entry.id === input.roleId && entry.enabled);
  if (!role) throw new RuntimeError('AGENT_ROLE_UNAVAILABLE', '选择的子 Agent 角色未启用。');
  if (
    (parent.task?.role.access === 'read-only' || parent.session.approvalMode === 'read-only') &&
    role.access === 'write'
  )
    throw new RuntimeError('AGENT_PERMISSION', '只读任务不能创建写入角色。');
  const count = [...tree.nodes].filter((entry) => entry.task).length;
  if (
    count >= Math.min(tree.settings.limits.maxTasks, currentSettings.limits.maxTasks) ||
    parent.depth >= Math.min(parent.limits.maxDepth, currentSettings.limits.maxDepth)
  )
    throw new RuntimeError('AGENT_LIMIT', '任务数量或嵌套深度已达到上限。');
  const limits = { ...parent.limits };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    limits[key] = Math.min(limits[key], currentSettings.limits[key]);
    const requested = input.limits?.[key];
    if (requested !== undefined) limits[key] = Math.min(limits[key], requested);
  }
  for (let scope: SubagentNode | undefined = parent; scope; scope = scope.parent) {
    const ancestor = scope;
    const descendants = [...tree.nodes].filter(
      (entry) => entry.task && isDescendant(entry, ancestor),
    );
    if (descendants.length >= scope.limits.maxTasks)
      throw new RuntimeError('AGENT_LIMIT', '当前任务或祖先的后代数量已达到上限。');
  }
  const owner = parent.task?.id ?? tree.rootRunId;
  if (role.access === 'write' && (tree.writer !== owner || (tree.writes.get(owner) ?? 0) !== 0))
    throw new RuntimeError('AGENT_WRITE_CONFLICT', '请等待现有写操作结算后再转交写入任务。');
  return { role, limits };
}

/** Explicit attachment forwarding stays inside the parent Run's accepted inputs. */
export function assertDelegatedAttachments(
  parent: SubagentNode,
  available: Pick<SessionSnapshot, 'messages'>,
  attachmentIds: readonly string[] | undefined,
): void {
  const attachments = new Set(
    available.messages
      .filter((message) => message.runId === parent.run.id)
      .flatMap((message) => message.attachmentIds ?? []),
  );
  if (attachmentIds?.some((id) => !attachments.has(id)))
    throw new RuntimeError('AGENT_ATTACHMENT_SCOPE', '只能转交当前执行已接收的附件。');
}

/** A discovery candidate cannot bypass the task's role through later activation. */
export function allowedTaskCandidates(
  candidates: readonly FrozenMcpTool[],
  access: AgentRole['access'],
): FrozenMcpTool[] {
  if (access === 'write') return [...candidates];
  return candidates.filter((tool) => tool.authorization.readOnlyGrantId !== undefined);
}

/** A task inherits only known native operations or external bindings allowed by its role. */
export function allowedTaskTool(
  record: RunToolSelection,
  access: AgentRole['access'],
  registrations?: readonly ToolRegistration[],
): boolean {
  if (record.source.kind === 'mcp')
    return access === 'write' || record.external?.authorization.readOnlyGrantId !== undefined;
  const entry = registrations
    ? registrations.find((entry) => entry.definition.name === record.definition.name)
    : nativeTool(record.definition.name);
  if (entry?.source.kind !== record.source.kind) return false;
  return access === 'write' || entry.readOnly;
}

/** Lineage membership follows the actual live parent chain, not a task-id prefix. */
export function isDescendant(candidate: SubagentNode, parent: SubagentNode): boolean {
  for (let current = candidate.parent; current; current = current.parent)
    if (current === parent) return true;
  return false;
}
