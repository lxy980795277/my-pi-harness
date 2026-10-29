import type { AgentRole, ProviderConfig } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectField } from '@/components/ui/select-field';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAgentRoleEditor } from '@/features/tasks/hooks/use-agent-role-editor';

interface AgentRoleEditorProps {
  role: AgentRole;
  providers: readonly ProviderConfig[];
  onChange: (role: AgentRole) => void;
  disabled: boolean;
}

/** Public role configuration has one explicit model and permission ceiling per role. */
export const AgentRoleEditor: FC<AgentRoleEditorProps> = ({
  role,
  providers,
  onChange,
  disabled,
}) => {
  const state = useAgentRoleEditor(role, providers, onChange);
  return (
    <section
      className="space-y-4 rounded-2xl border border-border p-4"
      aria-label={`${role.name} 角色配置`}
    >
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`agent-role-${role.id}-enabled`}>{role.name}</Label>
        <Switch
          id={`agent-role-${role.id}-enabled`}
          checked={role.enabled}
          onCheckedChange={state.changeEnabled}
          disabled={disabled}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`agent-role-${role.id}-name`}>名称</Label>
          <Input
            id={`agent-role-${role.id}-name`}
            value={role.name}
            onChange={state.changeName}
            maxLength={100}
            required
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`agent-role-${role.id}-access`}>执行权限上限</Label>
          <SelectField
            id={`agent-role-${role.id}-access`}
            value={role.access}
            options={state.accessOptions}
            onValueChange={state.changeAccess}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`agent-role-${role.id}-model`}>模型</Label>
          <SelectField
            id={`agent-role-${role.id}-model`}
            value={state.modelValue}
            options={state.modelOptions}
            onValueChange={state.changeModel}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`agent-role-${role.id}-thinking`}>推理强度</Label>
          <SelectField
            id={`agent-role-${role.id}-thinking`}
            value={state.thinkingValue}
            options={state.thinkingOptions}
            onValueChange={state.changeThinking}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`agent-role-${role.id}-description`}>简介</Label>
        <Input
          id={`agent-role-${role.id}-description`}
          value={role.description}
          onChange={state.changeDescription}
          maxLength={1000}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`agent-role-${role.id}-instructions`}>角色指令</Label>
        <Textarea
          id={`agent-role-${role.id}-instructions`}
          value={role.instructions}
          onChange={state.changeInstructions}
          className="min-h-24"
          maxLength={8000}
          required
          disabled={disabled}
        />
      </div>
    </section>
  );
};
