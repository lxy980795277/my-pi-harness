import type { FC } from 'react';
import type { RemoteMcpView } from '@my-pi-harness/protocol';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';
import { Notice } from '@/components/ui/notice';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { useRemoteMcpItem } from '@/features/mcp/hooks/use-remote-mcp-item';
import { McpDirectory } from '@/features/mcp/components/mcp-directory';
interface Props {
  server: RemoteMcpView;
  onEdit: (value: RemoteMcpView) => void;
}

/** Authorization is explicit; OAuth and static secrets are never treated as startup trust. */
export const RemoteMcpItem: FC<Props> = ({ server, onEdit }) => {
  const state = useRemoteMcpItem(server, onEdit);
  return (
    <section
      className="space-y-3 rounded-2xl border border-border p-4"
      aria-label={`${server.name} 远程 MCP`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{server.name}</h4>
        <span className="text-xs text-muted-foreground">
          {server.transport} · {server.enabled && '已启用'}
          {!server.enabled && '已停用'}
        </span>
      </div>
      <p className="font-mono text-xs break-all text-muted-foreground">{server.endpoint}</p>
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" onClick={state.startup} disabled={state.pending}>
          远端授权
        </Button>
        <Button
          variant="outline"
          onClick={state.discover}
          disabled={state.pending || !server.enabled}
        >
          发现目录
        </Button>
        <Button variant="ghost" onClick={state.edit} disabled={state.pending}>
          编辑配置
        </Button>
        <Button variant="outline" onClick={state.test} disabled={state.pending || !server.enabled}>
          测试连接
        </Button>
        <Button
          variant="ghost"
          onClick={state.openSecrets}
          disabled={
            state.pending ||
            (server.secretHeaders.length === 0 && server.oauthClient?.clientSecret !== true)
          }
        >
          秘密请求头
        </Button>
        {server.oauth && !server.oauthConnected && (
          <Button
            variant="outline"
            onClick={state.connect}
            disabled={state.pending || !server.enabled}
          >
            连接 OAuth
          </Button>
        )}
        {server.oauth && server.oauthConnected && (
          <Button variant="ghost" onClick={state.disconnect} disabled={state.pending}>
            断开 OAuth
          </Button>
        )}
        <Button variant="ghost" onClick={state.disable} disabled={state.pending || !server.enabled}>
          停用/撤销
        </Button>
        <Button variant="destructive" onClick={state.openDelete} disabled={state.pending}>
          删除
        </Button>
      </div>
      {state.oauthUrl && (
        <div className="flex gap-2">
          <Button variant="ghost" onClick={state.reopenOAuth}>
            重新打开授权页面
          </Button>
          <Button variant="ghost" onClick={state.refresh}>
            已完成授权，刷新
          </Button>
        </div>
      )}
      {state.pending && (
        <p role="status" className="text-xs text-muted-foreground">
          正在处理…
        </p>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.testSummary && (
        <p role="status" className="text-xs text-success-foreground">
          {state.testSummary}
        </p>
      )}
      <McpDirectory
        serverId={server.id}
        revision={server.revision}
        accessEpoch={server.accessEpoch}
        scope="sandboxed"
        transport="remote"
      />
      {state.preview && (
        <ConfirmDialog
          open
          onOpenChange={state.closeTrust}
          title="确认远端 MCP 授权？"
          description={`${state.preview.endpoint}；传输 ${state.preview.transport}。请求将访问此来源，并使用配置的认证头。此授权不代替工具调用审批。`}
          confirmLabel="确认远端范围"
          pending={state.pending}
          onConfirm={state.trust}
          error={state.trustError}
        />
      )}
      <Dialog open={state.secretsOpen} onOpenChange={state.changeSecrets}>
        <DialogContent closeLabel="关闭秘密请求头">
          <DialogTitle>秘密请求头</DialogTitle>
          <DialogDescription>
            秘密仅保存到本机凭据库，保存后需要重新确认远端授权。
          </DialogDescription>
          <SelectField
            id={`remote-secret-${server.id}`}
            ariaLabel="秘密请求头槽位"
            options={state.slotOptions}
            value={state.slot}
            onValueChange={state.changeSlot}
          />
          <Input
            type="password"
            aria-label="秘密请求头值"
            value={state.secret}
            onChange={state.changeSecret}
            autoComplete="off"
          />
          {state.saveSecretError && <Notice tone="error">{state.saveSecretError}</Notice>}
          <Button onClick={state.saveSecret} disabled={state.pending || state.secret.length === 0}>
            保存秘密
          </Button>
          <Button
            variant="destructive"
            onClick={state.removeSecret}
            disabled={state.pending || !state.canRemoveSecret}
          >
            删除秘密
          </Button>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={state.deleting}
        onOpenChange={state.changeDeleting}
        title="删除远程 MCP？"
        description="删除该配置、授权及其本机凭据。对话日志保留。"
        confirmLabel="删除"
        pending={state.pending}
        onConfirm={state.remove}
        error={state.removeError}
      />
    </section>
  );
};
