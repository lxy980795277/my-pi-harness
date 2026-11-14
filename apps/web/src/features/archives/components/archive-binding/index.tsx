import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { useArchiveBinding } from '@/features/archives/hooks/use-archive-binding';
import { describeError } from '@/utils/describe-error';

interface ArchiveBindingProps {
  sessionId: string;
}

/** Binding grants new local execution settings rather than restoring historical authority. */
export const ArchiveBinding: FC<ArchiveBindingProps> = ({ sessionId }) => {
  const state = useArchiveBinding(sessionId);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        选择本机当前配置后继续会话。历史模型引用和工作区仅供阅读，旧队列、批准、Skill
        选择与插件授权不会恢复。
      </p>
      {state.access.isError && <Notice tone="error">{describeError(state.access.error)}</Notice>}
      {state.error !== null && <Notice tone="error">{state.error}</Notice>}
      {state.access.data?.bound === true && (
        <Notice>当前会话已经绑定本机执行配置，可以返回会话。</Notice>
      )}
      <form onSubmit={state.submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="archive-current-model">当前模型</Label>
          <SelectField
            id="archive-current-model"
            value={state.modelKey}
            options={state.modelOptions}
            onValueChange={state.changeModel}
            placeholder="请选择当前可用模型"
            disabled={state.pending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="archive-current-thinking">推理强度</Label>
          <SelectField
            id="archive-current-thinking"
            value={state.thinking}
            options={state.thinkingOptions}
            onValueChange={state.changeThinking}
            placeholder="请先选择模型并读取其能力"
            disabled={state.pending || state.thinkingOptions.length === 0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="archive-current-workspace">当前工作区</Label>
          <SelectField
            id="archive-current-workspace"
            value={state.workspaceKey}
            options={state.workspaceOptions}
            onValueChange={state.changeWorkspace}
            placeholder="请选择工作区或不使用工作区"
            disabled={state.pending}
          />
        </div>
        <Notice>新执行使用“请求批准”模式。访问外部服务仍需当前本机已有的有效授权。</Notice>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={state.refresh} disabled={state.pending}>
            刷新配置
          </Button>
          <Button type="button" variant="outline" onClick={state.read}>
            先阅读会话
          </Button>
          <Button type="submit" disabled={state.disabled}>
            确认绑定并继续
          </Button>
        </div>
      </form>
    </div>
  );
};
