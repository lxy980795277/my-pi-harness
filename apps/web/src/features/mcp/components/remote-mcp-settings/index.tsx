import type { FC } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useRemoteMcpSettings } from '@/features/mcp/hooks/use-remote-mcp-settings';
import { RemoteMcpItem } from '@/features/mcp/components/remote-mcp-item';
import { RemoteMcpEditor } from '@/features/mcp/components/remote-mcp-editor';

/** Remote MCP is the primary settings entry and does not require a workspace. */
export const RemoteMcpSettings: FC = () => {
  const state = useRemoteMcpSettings();
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">MCP</h2>
        <Button onClick={state.open} className="rounded-full">
          <Plus width={15} height={15} aria-hidden />
          添加 MCP 服务器
        </Button>
      </div>
      {state.query.isPending && (
        <p className="text-xs text-muted-foreground" role="status">
          正在读取配置…
        </p>
      )}
      {state.query.error && <Notice tone="error">{state.query.error.message}</Notice>}
      {state.query.data?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">尚未配置 MCP 服务器</p>
      )}
      {state.query.data?.map((server) => {
        return <RemoteMcpItem key={server.id} server={server} onEdit={state.edit} />;
      })}
      {state.editing !== undefined && (
        <RemoteMcpEditor key={state.editorKey} server={state.editing} onClose={state.close} />
      )}
    </section>
  );
};
