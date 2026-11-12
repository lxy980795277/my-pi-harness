import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useMemoryEditor } from '@/features/memory/hooks/use-memory-editor';
import type { MemoryEditorProps } from '@/features/memory/types/memory';
import { MEMORY_CATEGORIES, MEMORY_MODES } from '@/features/memory/utils/memory-view';

/** Saving confirms only the edited text and its displayed scope. */
export const MemoryEditor: FC<MemoryEditorProps> = (props) => {
  const state = useMemoryEditor(props);
  return (
    <Dialog open onOpenChange={state.changeOpen}>
      <DialogContent className="max-w-xl" closeLabel="关闭记忆编辑">
        <DialogTitle>{state.title}</DialogTitle>
        <DialogDescription>{state.sourceLabel}</DialogDescription>
        <form className="space-y-4" onSubmit={state.submit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="memory-editor-scope">保存范围</Label>
              <SelectField
                id="memory-editor-scope"
                value={state.scope}
                options={state.scopeOptions}
                onValueChange={state.changeScope}
                disabled={state.scopeLocked || state.save.pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-editor-category">类型</Label>
              <SelectField
                id="memory-editor-category"
                value={state.category}
                options={MEMORY_CATEGORIES}
                onValueChange={state.changeCategory}
                disabled={state.save.pending}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="memory-editor-mode">采用方式</Label>
            <SelectField
              id="memory-editor-mode"
              value={state.mode}
              options={MEMORY_MODES}
              onValueChange={state.changeMode}
              disabled={state.save.pending}
            />
            {state.mode === 'relevant' && (
              <p className="text-xs leading-5 text-muted-foreground">
                需在“记忆与搜索”中准备相关性复核模型。未准备时，固定记忆与人工搜索仍可使用。
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="memory-editor-body">记忆内容</Label>
            <Textarea
              id="memory-editor-body"
              value={state.body}
              onChange={state.changeBody}
              maxLength={16000}
              required
              disabled={state.save.pending}
              className="max-h-64 min-h-36"
            />
          </div>
          {state.body.length > 16000 && (
            <Notice>请将要长期保留的内容精简到 16,000 字符以内。</Notice>
          )}
          <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 p-3">
            <div className="space-y-1">
              <Label htmlFor="memory-editor-enabled">启用记忆</Label>
              <p className="text-xs text-muted-foreground">
                开启后按所选方式用于范围内的新模型请求。
              </p>
            </div>
            <Switch
              id="memory-editor-enabled"
              checked={state.enabled}
              onCheckedChange={state.changeEnabled}
              disabled={state.save.pending}
            />
          </div>
          {state.save.error && <Notice tone="error">{state.save.error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={state.close}
              disabled={state.save.pending}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                state.save.pending || state.body.trim().length === 0 || state.body.length > 16000
              }
            >
              {state.save.pending && '正在保存…'}
              {!state.save.pending && '保存记忆'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
