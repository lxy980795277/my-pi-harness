import type { AgentSettings } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { AgentRoleEditor } from '@/features/tasks/components/agent-role-editor';
import { useAgentSettingsEditor } from '@/features/tasks/hooks/use-agent-settings';

interface AgentSettingsEditorProps {
  initial: AgentSettings;
}

/** Local drafts retain their expected revision until an explicit save or reload. */
export const AgentSettingsEditor: FC<AgentSettingsEditorProps> = ({ initial }) => {
  const state = useAgentSettingsEditor(initial);
  return (
    <form className="space-y-6" onSubmit={state.submit}>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="agent-settings-enabled">允许 Agent 委派子任务</Label>
        <Switch
          id="agent-settings-enabled"
          checked={state.draft.enabled}
          onCheckedChange={state.changeEnabled}
          disabled={state.save.pending}
        />
      </div>
      <div className="space-y-4">
        {state.draft.roles.map((role) => {
          return (
            <AgentRoleEditor
              key={role.id}
              role={role}
              providers={state.providers}
              onChange={state.updateRole}
              disabled={state.save.pending}
            />
          );
        })}
      </div>
      <section className="space-y-4" aria-label="任务执行限制">
        <h3 className="text-sm font-semibold">执行限制</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {state.fields.map((field) => {
            return (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`agent-limit-${field.key}`}>{field.label}</Label>
                <Input
                  id={`agent-limit-${field.key}`}
                  type="number"
                  min={1}
                  step={1}
                  value={field.value}
                  onChange={field.change}
                  required
                  disabled={state.save.pending}
                />
              </div>
            );
          })}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          所有角色继续受父任务的工作区和审批策略约束。
        </p>
      </section>
      {state.save.error && <Notice tone="error">{state.save.error}</Notice>}
      {state.reload.error && <Notice tone="error">{state.reload.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={state.reload.run}
          disabled={state.save.pending || state.reload.pending}
        >
          重新读取
        </Button>
        <Button type="submit" disabled={state.save.pending || state.reload.pending}>
          保存子 Agent 设置
        </Button>
      </div>
    </form>
  );
};
