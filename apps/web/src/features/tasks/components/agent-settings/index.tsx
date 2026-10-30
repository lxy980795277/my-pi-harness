import type { FC } from 'react';
import { Notice } from '@/components/ui/notice';
import { AgentSettingsEditor } from '@/features/tasks/components/agent-settings-editor';
import { useAgentSettingsQuery } from '@/features/tasks/hooks/use-agent-settings';
import { describeError } from '@/utils/describe-error';

/** Role and execution limit settings share the daemon's revision-checked configuration. */
export const AgentSettingsPanel: FC = () => {
  const query = useAgentSettingsQuery();
  return (
    <div className="space-y-6 p-8">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">子 Agent</h2>
        <p className="text-xs text-muted-foreground">
          配置任务角色、模型和执行限制，保存后对新任务生效。
        </p>
      </div>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取设置…
        </p>
      )}
      {query.isError && <Notice tone="error">{describeError(query.error)}</Notice>}
      {query.data && <AgentSettingsEditor initial={query.data} />}
    </div>
  );
};
