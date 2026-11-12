import type { FC, PropsWithChildren } from 'react';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { MemoryEditor } from '@/features/memory/components/memory-editor';
import { MemoryManager } from '@/features/memory/components/memory-manager';
import { useMemoryPanel } from '@/features/memory/hooks/use-memory-panel';

/** Use and automatic learning share server settings; manual management remains available. */
export const MemorySettingsPanel: FC<PropsWithChildren> = ({ children }) => {
  const state = useMemoryPanel();
  return (
    <div className="space-y-6 p-8">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">记忆</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          保存你希望 Agent 在后续对话中沿用的偏好、事实和约定。
        </p>
      </div>
      {state.settings.isPending && <Notice>正在读取记忆设置…</Notice>}
      {state.settings.isError && <Notice tone="error">{state.settings.error.message}</Notice>}
      {state.settings.data && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-muted/40 p-4">
            <div className="space-y-1">
              <Label htmlFor="memory-allow-use">使用记忆</Label>
              <p className="text-xs leading-5 text-muted-foreground">
                开启后，范围内已启用的记忆会按固定或相关方式用于新模型请求。关闭后仍可人工管理。
              </p>
            </div>
            <Switch
              id="memory-allow-use"
              checked={state.settings.data.allowUse}
              onCheckedChange={state.changeAllowUse}
              disabled={state.updateSettings.pending}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-muted/40 p-4">
            <div className="space-y-1">
              <Label htmlFor="memory-allow-learning">从对话中学习</Label>
              <p className="text-xs leading-5 text-muted-foreground">
                自动保存可跨对话复用的稳定偏好和事实。明确要求记住或修改的内容可以直接保存。
              </p>
            </div>
            <Switch
              id="memory-allow-learning"
              checked={state.settings.data.allowLearning}
              onCheckedChange={state.changeAllowLearning}
              disabled={!state.settings.data.allowUse || state.updateSettings.pending}
            />
          </div>
        </div>
      )}
      {state.updateSettings.error && <Notice tone="error">{state.updateSettings.error}</Notice>}
      {state.workspaceError && <Notice tone="error">{state.workspaceError}</Notice>}
      {children}
      <MemoryManager state={state} />
      {state.editor && (
        <MemoryEditor target={state.editor} onClose={state.closeEditor} onSaved={state.resetPage} />
      )}
    </div>
  );
};
