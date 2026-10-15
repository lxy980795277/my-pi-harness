import type { FC } from 'react';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/select-field';
import { Notice } from '@/components/ui/notice';
import { useDefaultModel } from '@/features/models/hooks/use-default-model';

/** The profile default affects new conversations without changing existing selections. */
export const DefaultModelPicker: FC = () => {
  const state = useDefaultModel();
  return (
    <section className="space-y-4 rounded-2xl bg-muted/60 p-5" aria-label="默认模型设置">
      <div>
        <h3 className="text-sm font-semibold">默认模型</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          新会话使用此模型，已有会话保持原有选择。
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="默认模型" htmlFor="default-model">
          <SelectField
            id="default-model"
            value={state.selectedKey}
            onValueChange={state.changeModel}
            options={state.options}
            placeholder="请选择已配置的模型"
            disabled={state.pending}
          />
        </Field>
        <Field label="默认思考等级" htmlFor="default-thinking">
          <SelectField
            id="default-thinking"
            value={state.thinking}
            onValueChange={state.changeThinking}
            options={state.thinkingOptions}
            disabled={state.pending || state.invalid || state.selectedKey.length === 0}
          />
        </Field>
      </div>
      {state.invalid && (
        <Notice tone="error">保存的默认模型已不可用，请重新选择。系统不会自动更换模型。</Notice>
      )}
      {state.options.length === 0 && (
        <p className="text-xs text-muted-foreground">请先配置并启用 Provider，再选择默认模型。</p>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </section>
  );
};
