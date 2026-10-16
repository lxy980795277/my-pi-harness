import type { SettingsDialogProps } from '@/features/settings/types/settings';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Suspense, type FC } from 'react';
import { Settings2, Sparkles } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { Tabs } from '@/components/ui/tabs';
import { TabsList } from '@/components/ui/tabs/tabs-list';
import { TabsTrigger } from '@/components/ui/tabs/tabs-trigger';
import { TabsContent } from '@/components/ui/tabs/tabs-content';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Notice } from '@/components/ui/notice';
import { LazyModelsPage } from '@/features/models/utils/load-models-page';
import { SettingsLoading } from '@/features/settings/components/settings-loading';
import { useSettingsDialog } from '@/features/settings/hooks/use-settings-dialog';

/** A modal settings workspace leaves the conversation mounted behind it. */
export const SettingsDialog: FC<SettingsDialogProps> = ({ theme, onToggleTheme }) => {
  const state = useSettingsDialog();
  return (
    <Dialog open={state.open} onOpenChange={state.changeOpen}>
      <DialogContent
        className="h-[640px] max-w-5xl gap-0 overflow-hidden p-0"
        closeLabel="关闭设置"
      >
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">应用设置与模型服务商配置</DialogDescription>
        <Tabs
          value={state.section}
          onValueChange={state.changeSection}
          orientation="vertical"
          className="flex h-full min-h-0"
        >
          <aside className="w-48 shrink-0 border-r border-border bg-muted/40 p-4">
            <p className="px-3 py-4 text-lg font-semibold">设置</p>
            <TabsList className="flex h-auto w-full flex-col items-stretch gap-1 bg-transparent">
              <TabsTrigger value="general" className="justify-start gap-2 rounded-xl px-3 py-2.5">
                <Settings2 width={15} height={15} aria-hidden />
                通用设置
              </TabsTrigger>
              <TabsTrigger value="models" className="justify-start gap-2 rounded-xl px-3 py-2.5">
                <Sparkles width={15} height={15} aria-hidden />
                模型
              </TabsTrigger>
            </TabsList>
          </aside>
          <ScrollArea className="my-5 mr-3 min-h-0 min-w-0 flex-1">
            <TabsContent value="general" className="m-0 p-8">
              <h2 className="text-xl font-semibold">通用设置</h2>
              <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-muted/60 p-5">
                <div>
                  <Label htmlFor="settings-dark-theme">深色模式</Label>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    选择工作台外观，偏好保存在当前设备。
                  </p>
                </div>
                <Switch
                  id="settings-dark-theme"
                  checked={theme === 'dark'}
                  onCheckedChange={onToggleTheme}
                />
              </div>
            </TabsContent>
            <TabsContent value="models" className="m-0">
              <Suspense fallback={<SettingsLoading />}>
                <LazyModelsPage />
              </Suspense>
            </TabsContent>
            {state.closeError && <Notice tone="error">{state.closeError}</Notice>}
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
