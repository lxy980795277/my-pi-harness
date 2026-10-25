import type { FC } from 'react';
import { Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { McpTrustDialog } from '@/features/mcp/components/mcp-trust-dialog';
import { McpDirectory } from '@/features/mcp/components/mcp-directory';
import { McpSecretDialog } from '@/features/mcp/components/mcp-secret-dialog';
import { useMcpServerItem } from '@/features/mcp/hooks/use-mcp-server-item';
import type { McpServerItemProps } from '@/features/mcp/types/mcp';

const SCOPE_OPTIONS = [
  { value: 'sandboxed', label: '受监管隔离' },
  { value: 'full-access', label: '完全访问权限' },
];
/** Safe configuration, explicit startup and cached discovery remain visibly separate actions. */
export const McpServerItem: FC<McpServerItemProps> = ({ server, workspaceName, onEdit }) => {
  const state = useMcpServerItem(server, onEdit);
  return (
    <section
      className="space-y-3 rounded-2xl border border-border p-4"
      aria-label={`${server.name} MCP Server`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Plug width={16} height={16} aria-hidden />
        <h3 className="font-medium">{server.name}</h3>
        <Badge>
          {server.connectionState === 'connected' && '已连接'}
          {server.connectionState === 'disconnected' && '未连接'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {server.enabled && '已启用'}
          {!server.enabled && '已停用'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{workspaceName}</p>
      <p className="truncate font-mono text-xs text-muted-foreground">{server.command}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          id={`mcp-scope-${server.id}`}
          ariaLabel={`${server.name} 启动范围`}
          value={state.scope}
          options={SCOPE_OPTIONS}
          onValueChange={state.changeScope}
          disabled={state.pending}
        />
        <span className="text-xs text-muted-foreground">
          {state.trusted && '当前范围已授权'}
          {!state.trusted && '当前范围未授权'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" onClick={state.startup} disabled={state.pending}>
          启动授权
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={state.discoverTools}
          disabled={state.pending || !state.trusted}
        >
          发现工具
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={state.test}
          disabled={state.pending || !state.trusted}
        >
          测试连接
        </Button>
        <Button type="button" variant="ghost" onClick={state.edit} disabled={state.pending}>
          编辑
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={state.openSecrets}
          disabled={state.pending || server.secretSlots.length === 0}
        >
          秘密
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={state.disable}
          disabled={state.pending || !server.enabled}
        >
          停用
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={state.revoke}
          disabled={state.pending || server.trustedScopes.length === 0}
        >
          撤销授权
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={state.openDelete}
          disabled={state.pending}
        >
          删除
        </Button>
      </div>
      {state.pending && (
        <p className="text-xs text-muted-foreground" role="status">
          正在处理…
        </p>
      )}
      {!state.catalog && (
        <p className="text-xs text-muted-foreground">
          尚未发现当前范围的工具。发现与测试会启动本机程序。
        </p>
      )}
      <McpDirectory
        serverId={server.id}
        revision={server.revision}
        accessEpoch={server.accessEpoch}
        scope={state.scope}
        transport="stdio"
      />
      {server.diagnostic && <Notice>{server.diagnostic}</Notice>}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.preview && (
        <McpTrustDialog
          preview={state.preview}
          pending={state.pending}
          error={state.trustError}
          onOpenChange={state.closeTrust}
          onConfirm={state.trust}
        />
      )}
      {state.secretsOpen && <McpSecretDialog server={server} onClose={state.closeSecrets} />}
      <ConfirmDialog
        open={state.deleteOpen}
        onOpenChange={state.changeDeleteOpen}
        title="删除 MCP Server？"
        description="删除本机配置及启动授权，已记录的对话日志会保留。"
        confirmLabel="删除"
        pending={state.pending}
        onConfirm={state.remove}
        error={state.deleteError}
      />
    </section>
  );
};
