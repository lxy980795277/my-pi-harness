import type { AgentSettings } from '@my-pi-harness/protocol';

/** Resolve application-owned defaults before configuration is used or persisted. */
export function defaultAgentSettings(): AgentSettings {
  return {
    revision: 0,
    enabled: true,
    limits: {
      maxTasks: 16,
      maxDepth: 3,
      maxConcurrentRequests: 4,
      timeoutMs: 600_000,
      maxOutputTokens: 4096,
    },
    roles: [
      {
        id: 'researcher',
        name: '调查',
        description: '读取资料、核对来源并给出有依据的结论。',
        instructions: '独立核对分配的任务，保持只读。区分已验证事实和推测，返回简洁结论与来源。',
        enabled: true,
        access: 'read-only',
        providerId: null,
        modelId: null,
        thinkingLevel: null,
      },
      {
        id: 'reviewer',
        name: '审查',
        description: '审查实现、定位风险并报告可复现的问题。',
        instructions: '只读审查分配的内容，优先报告有证据的问题和影响，说明未验证的部分。',
        enabled: true,
        access: 'read-only',
        providerId: null,
        modelId: null,
        thinkingLevel: null,
      },
      {
        id: 'worker',
        name: '执行',
        description: '在父任务授予的范围内完成修改并验证结果。',
        instructions:
          '完成分配的任务，遵守继承的权限、写入拥有权与执行限制。报告实际修改、验证及剩余问题。',
        enabled: true,
        access: 'write',
        providerId: null,
        modelId: null,
        thinkingLevel: null,
      },
    ],
  };
}
