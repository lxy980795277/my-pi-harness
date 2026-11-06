import {
  spawnAgentTool,
  getAgentStatusTool,
  waitAgentsTool,
  sendAgentMessageTool,
  stopAgentTool,
} from '@my-pi-harness/tools';

/** Application-owned role descriptions become replayable model input at acceptance. */
export function agentContext(
  roles: readonly { id: string; name: string; description: string; enabled: boolean }[],
): string {
  const enabled = roles.filter((role) => role.enabled);
  if (enabled.length === 0) return '';
  const controls = [
    spawnAgentTool,
    getAgentStatusTool,
    waitAgentsTool,
    sendAgentMessageTool,
    stopAgentTool,
  ];
  return `Delegate independent, bounded work when useful. Use wait_agents to collect descendant results before your final answer; stop unnecessary tasks. Child contexts contain only explicitly forwarded inputs. Available roles:\n${enabled.map((role) => `${role.id}: ${role.name} — ${role.description}`).join('\n')}\nTask controls: ${controls.map((tool) => tool.definition.name).join(', ')}.`;
}
