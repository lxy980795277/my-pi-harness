import type { FC } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { Notice } from '@/components/ui/notice';
import { DefaultModelPicker } from '@/features/models/components/default-model';
import { ProviderCard } from '@/features/models/components/provider-card';
import { ProviderEditor } from '@/features/models/components/provider-editor';
import { ProviderModelsDialog } from '@/features/models/components/provider-models-dialog';
import { useModelSettings } from '@/features/models/hooks/use-model-settings';
import { useProviderDialogClose } from '@/features/settings/hooks/use-provider-dialog-close';
import { describeError } from '@/utils/describe-error';

/** Model settings share one provider catalog across the parent and two focused child dialogs. */
export const ModelsPage: FC = () => {
  const state = useModelSettings();
  const close = useProviderDialogClose();
  return (
    <div className="mx-auto max-w-[720px] space-y-6 px-6 py-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">模型</h2>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            管理模型服务商和认证，选择适合你的默认模型。
          </p>
        </div>
        <Button type="button" className="shrink-0 rounded-full" onClick={state.addProvider}>
          <Plus width={14} height={14} aria-hidden />
          添加 Provider
        </Button>
      </header>
      <DefaultModelPicker />
      <div>
        <h3 className="text-sm font-medium">Provider</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          已配置 {state.configuredCount} 个，共可使用 {state.availableModelCount} 个模型。
        </p>
      </div>
      {state.providers.isPending && <Notice>正在读取 Provider…</Notice>}
      {state.providers.isError && (
        <Notice tone="error">{describeError(state.providers.error)}</Notice>
      )}
      {state.nativeProviders.isError && (
        <Notice tone="error">{describeError(state.nativeProviders.error)}</Notice>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="space-y-4">
        {state.providers.data?.map((provider) => {
          return (
            <ProviderCard
              key={provider.id}
              provider={provider}
              pending={state.toggling || state.nativeProviders.isPending}
              onOpen={state.openProvider}
              onModels={state.openModels}
              onToggle={state.toggle}
            />
          );
        })}
      </div>
      <Dialog open={state.providerId !== null} onOpenChange={close.changeOpen}>
        <DialogContent className="max-w-lg" closeLabel="关闭 Provider 配置">
          {state.providerId !== null && !state.providerMissing && (
            <ProviderEditor
              key={state.providerId}
              provider={state.provider}
              native={state.native}
              onClose={close.close}
            />
          )}
          {state.providerMissing && (
            <>
              <DialogTitle>Provider 已不可用</DialogTitle>
              <DialogDescription>此配置已被删除，请关闭弹窗后重新选择。</DialogDescription>
              <Button type="button" onClick={close.close}>
                关闭
              </Button>
            </>
          )}
          {close.error && <Notice tone="error">{close.error}</Notice>}
        </DialogContent>
      </Dialog>
      <Dialog open={state.modelsProvider !== null} onOpenChange={state.modelsOpenChange}>
        <DialogContent className="max-w-xl" closeLabel="关闭模型管理" aria-describedby={undefined}>
          {state.modelsProvider && (
            <ProviderModelsDialog key={state.modelsProvider.id} provider={state.modelsProvider} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
