import type { ProviderConfig } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { ModelEditor } from '@/features/models/components/model-editor';
import { useProviderModelsEditor } from '@/features/models/hooks/use-provider-models-editor';

interface ProviderModelsDialogProps {
  provider: ProviderConfig;
}

/** Model management is a separate dialog from authentication and provider metadata. */
export const ProviderModelsDialog: FC<ProviderModelsDialogProps> = ({ provider }) => {
  const state = useProviderModelsEditor(provider);
  return (
    <>
      <DialogTitle>{provider.name} 模型</DialogTitle>
      <form className="space-y-4" onSubmit={state.submit} aria-label="模型列表">
        {state.custom && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="新增模型 ID" htmlFor="new-model-id">
                <Input
                  id="new-model-id"
                  value={state.newId}
                  onChange={state.changeNewId}
                  placeholder="例如 deepseek-chat"
                />
              </Field>
            </div>
            <Button
              type="button"
              onClick={state.add}
              disabled={state.pending || state.newId.length === 0}
              className="rounded-full"
            >
              添加
            </Button>
          </div>
        )}
        <div className="max-h-[52svh] space-y-3 overflow-y-auto">
          {state.models.map((model) => {
            return (
              <ModelEditor
                key={model.id}
                model={model}
                custom={state.custom}
                pending={state.pending || state.testing}
                testDisabled={!state.persistedIds.has(model.id)}
                result={state.results[model.id]}
                onUpdate={state.update}
                onRemove={state.remove}
                onTest={state.test}
              />
            );
          })}
          {state.models.length === 0 && (
            <Notice>尚未添加模型。Provider 可以先保存，再补充模型。</Notice>
          )}
        </div>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={state.close} disabled={state.pending}>
            关闭
          </Button>
          {state.custom && (
            <Button type="submit" className="rounded-full" disabled={state.pending}>
              保存
            </Button>
          )}
        </div>
      </form>
    </>
  );
};
