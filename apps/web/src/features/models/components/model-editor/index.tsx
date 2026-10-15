import type { ConnectionResult, ModelDefinition } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { useModelRow } from '@/features/models/hooks/use-model-row';

interface ModelEditorProps {
  model: ModelDefinition;
  custom: boolean;
  pending: boolean;
  testDisabled: boolean;
  result: ConnectionResult | undefined;
  onUpdate: (model: ModelDefinition) => void;
  onRemove: (id: string) => void;
  onTest: (id: string) => void;
}

/** Builtin capabilities are read-only; custom rows edit only the reference's four model fields. */
export const ModelEditor: FC<ModelEditorProps> = ({
  model,
  custom,
  pending,
  testDisabled,
  result,
  onUpdate,
  onRemove,
  onTest,
}) => {
  const state = useModelRow(model, onUpdate, onRemove, onTest);
  return (
    <section className="space-y-3 rounded-xl bg-muted/60 p-4" aria-label={model.id}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 font-mono text-xs font-semibold break-all">{model.id}</h3>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`测试 ${model.id} 连接`}
            onClick={state.testModel}
            disabled={pending || testDisabled}
          >
            <Zap width={14} height={14} aria-hidden />
          </Button>
          {custom && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`删除模型 ${model.id}`}
              onClick={state.removeModel}
              disabled={pending}
            >
              <Trash2 width={14} height={14} aria-hidden />
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="上下文长度" htmlFor={`context-${model.id}`}>
          <Input
            id={`context-${model.id}`}
            type="number"
            min="1"
            step="1"
            value={model.contextWindow}
            onChange={state.changeContext}
            readOnly={!custom}
            required
          />
        </Field>
        <Field label="最大输出 Token" htmlFor={`tokens-${model.id}`}>
          <Input
            id={`tokens-${model.id}`}
            type="number"
            min="1"
            step="1"
            value={model.maxTokens}
            onChange={state.changeTokens}
            readOnly={!custom}
            required
          />
        </Field>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`reasoning-${model.id}`}>支持推理</Label>
        <Switch
          id={`reasoning-${model.id}`}
          checked={model.reasoning}
          onCheckedChange={state.changeReasoning}
          disabled={!custom || pending}
        />
      </div>
      {testDisabled && (
        <p className="text-[11px] text-muted-foreground">保存新增模型后可测试连接。</p>
      )}
      {result && result.ok && <Notice tone="success">{result.message}</Notice>}
      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
    </section>
  );
};
