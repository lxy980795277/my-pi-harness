import type { FC } from 'react';
import { Link2, Unplug, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { useConnectionItem } from '@/features/connections/hooks/use-connection-item';
import type { ConnectionItemProps } from '@/features/connections/types/connection';

/** Account status and OAuth actions expose no stored token or credential reference. */
export const ConnectionItem: FC<ConnectionItemProps> = ({ connection, onEdit }) => {
  const state = useConnectionItem(connection, onEdit);
  return (
    <article className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">{connection.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {connection.serviceId} · {connection.authMode}
          </p>
          <p className="mt-1 text-sm">
            {connection.connected && (
              <span className="text-success-solid">已连接 · {connection.accountName}</span>
            )}
            {!connection.connected && <span className="text-muted-foreground">尚未连接</span>}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" onClick={state.edit} disabled={state.pending}>
            编辑
          </Button>
          <Button variant="ghost" onClick={state.askDelete} disabled={state.pending}>
            删除
          </Button>
        </div>
      </div>
      {connection.scopes.length > 0 && (
        <p className="text-xs break-all text-muted-foreground">
          权限：{connection.scopes.join(' · ')}
        </p>
      )}
      <div className="flex gap-2">
        <Input
          type="password"
          aria-label={`${state.secretLabel} · ${connection.name}`}
          autoComplete="off"
          value={state.secret}
          onChange={state.changeSecret}
          placeholder={state.secretLabel}
          disabled={state.pending}
        />
        <Button
          variant="outline"
          onClick={state.save}
          disabled={state.pending || state.secret.length === 0}
        >
          {state.saveLabel}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {connection.authMode === 'oauth' && (
          <Button variant="outline" onClick={state.connect} disabled={state.pending}>
            <Link2 aria-hidden className="size-4" />
            连接账户
          </Button>
        )}
        {connection.connected && (
          <Button variant="ghost" onClick={state.disconnect} disabled={state.pending}>
            <Unplug aria-hidden className="size-4" />
            断开
          </Button>
        )}
        {state.oauthUrl !== null && (
          <>
            <Button variant="ghost" onClick={state.reopen}>
              <ExternalLink aria-hidden className="size-4" />
              重新打开授权页
            </Button>
            <Button variant="ghost" onClick={state.cancel} disabled={state.pending}>
              取消授权
            </Button>
          </>
        )}
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <ConfirmDialog
        open={state.deleting}
        onOpenChange={state.closeDelete}
        title={`删除 ${connection.name}？`}
        description="此连接的账户授权与当前Run授权将失效。其他连接及应用登录不受影响。"
        confirmLabel="删除连接"
        pending={state.pending}
        onConfirm={state.remove}
        error={state.error}
      />
    </article>
  );
};
