import type { AgentLimits, AgentRole } from '@my-pi-harness/protocol';

/** Stable task data for rendering and request-recovery cases. */
export function taskSettingsFixture(): { role: AgentRole; limits: AgentLimits } {
  return {
    role: {
      id: 'fixture-role',
      name: 'Fixture role',
      description: 'Read fixture sources.',
      instructions: 'Read the assigned fixture.',
      enabled: true,
      access: 'read-only',
      providerId: null,
      modelId: null,
      thinkingLevel: null,
    },
    limits: {
      maxTasks: 16,
      maxDepth: 3,
      maxConcurrentRequests: 4,
      timeoutMs: 600_000,
      maxOutputTokens: 4096,
    },
  };
}
