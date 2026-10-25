import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Textarea } from '@/components/ui/textarea';
import { SelectField } from '@/components/ui/select-field';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { useConnectionsSettings } from '@/features/connections/hooks/use-connections-settings';
import { ConnectionItem } from '@/features/connections/components/connection-item';

/** Five provider families share the same explicit connection management flow. */
export const ConnectionsSettings: FC = () => {
  const state = useConnectionsSettings();
  return (
    <section className="space-y-5 p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">外部服务连接</h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={state.refresh}>
            刷新状态
          </Button>
          <Button onClick={state.open}>添加连接</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        GitHub、Google Workspace、Vercel、Notion 和
        Supabase。账户连接与应用登录分别管理；使用前请安装对应插件，并在对话中明确授权操作。
      </p>
      {state.connections.error && <Notice tone="error">{state.connections.error.message}</Notice>}
      {state.providers.error && <Notice tone="error">{state.providers.error.message}</Notice>}
      {state.connections.data?.map((connection) => {
        return <ConnectionItem key={connection.id} connection={connection} onEdit={state.edit} />;
      })}
      {state.connections.data?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">尚未添加外部连接</p>
      )}
      <Dialog open={state.editing !== undefined} onOpenChange={state.close}>
        <DialogContent className="max-w-xl" closeLabel="关闭连接配置">
          <DialogTitle>外部连接配置</DialogTitle>
          <DialogDescription>
            只填写公开配置。Client Secret 或访问Token在保存后单独录入，留在系统凭据库。
          </DialogDescription>
          <Label htmlFor="connection-provider">服务</Label>
          <SelectField
            id="connection-provider"
            ariaLabel="连接服务"
            value={state.serviceId}
            options={state.providerOptions}
            onValueChange={state.changeService}
            disabled={state.editing !== null || state.pending}
          />
          <Label htmlFor="connection-name">名称</Label>
          <Input id="connection-name" value={state.name} onChange={state.changeName} />
          <SelectField
            id="connection-auth-mode"
            ariaLabel="连接授权方式"
            value={state.authMode}
            options={[
              { label: 'OAuth', value: 'oauth' },
              { label: '访问 Token', value: 'token' },
            ]}
            onValueChange={state.changeAuth}
            disabled={state.pending}
          />
          {state.authMode === 'oauth' && (
            <>
              <Label htmlFor="connection-client-id">OAuth Client ID</Label>
              <Input
                id="connection-client-id"
                value={state.clientId}
                onChange={state.changeClientId}
                autoComplete="off"
              />
            </>
          )}
          <Label htmlFor="connection-scopes">权限范围（每行一项）</Label>
          <Textarea
            id="connection-scopes"
            value={state.scopes}
            onChange={state.changeScopes}
            className="min-h-24 text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Google五个子App共用一个连接；供应商客户端仍需启用所需API和权限，真实授权以供应商页面为准。
          </p>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <Button onClick={state.save} disabled={state.pending}>
            保存配置
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
};
