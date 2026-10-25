import type { FC } from 'react';
import type { RemoteMcpView } from '@my-pi-harness/protocol';
import { CheckCircle2, LoaderCircle, PlugZap } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SelectField } from '@/components/ui/select-field';
import { Notice } from '@/components/ui/notice';
import { Tabs } from '@/components/ui/tabs';
import { TabsList } from '@/components/ui/tabs/tabs-list';
import { TabsTrigger } from '@/components/ui/tabs/tabs-trigger';
import { TabsContent } from '@/components/ui/tabs/tabs-content';
import { RemoteMcpForm } from '@/features/mcp/components/remote-mcp-form';
import { useRemoteMcpEditor } from '@/features/mcp/hooks/use-remote-mcp-editor';

interface RemoteMcpEditorProps {
  server: RemoteMcpView | null;
  onClose: () => void;
}

/** Form and JSON are alternate editors for the same draft and explicit connection test. */
export const RemoteMcpEditor: FC<RemoteMcpEditorProps> = ({ server, onClose }) => {
  const state = useRemoteMcpEditor(server, onClose);
  return (
    <Dialog open onOpenChange={state.changeOpen}>
      <DialogContent
        className="max-w-2xl gap-6 rounded-3xl p-6 sm:p-8"
        closeLabel="关闭 MCP 配置"
        aria-describedby={undefined}
      >
        <DialogTitle className="pr-8 text-xl">{state.title}</DialogTitle>
        <form className="space-y-5" onSubmit={state.submit}>
          <Tabs value={state.mode} onValueChange={state.changeMode}>
            <TabsList className="mb-6 flex h-11 w-full rounded-full bg-muted p-1">
              <TabsTrigger
                value="form"
                className="h-full flex-1 rounded-full text-sm"
                disabled={state.pending}
              >
                表单配置
              </TabsTrigger>
              <TabsTrigger
                value="json"
                className="h-full flex-1 rounded-full text-sm"
                disabled={state.pending}
              >
                JSON 配置
              </TabsTrigger>
            </TabsList>
            <TabsContent value="form">
              <RemoteMcpForm state={state} />
              <details className="mt-5 text-xs">
                <summary className="cursor-pointer text-muted-foreground">认证设置</summary>
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="remote-mcp-oauth">OAuth 认证</Label>
                    <Switch
                      id="remote-mcp-oauth"
                      checked={state.draft.oauth}
                      onCheckedChange={state.changeOAuth}
                      disabled={state.pending}
                    />
                  </div>
                  {state.connectionOptions.length > 1 && (
                    <Field label="认证来源" htmlFor="remote-mcp-connection">
                      <SelectField
                        id="remote-mcp-connection"
                        ariaLabel="远程MCP认证来源"
                        value={state.connectionId}
                        onValueChange={state.changeConnection}
                        options={state.connectionOptions}
                        disabled={state.pending}
                      />
                    </Field>
                  )}
                </div>
              </details>
            </TabsContent>
            <TabsContent value="json" className="space-y-2">
              <Field label="mcp.json" htmlFor="remote-mcp-json">
                <Textarea
                  id="remote-mcp-json"
                  aria-label="远程 MCP JSON"
                  className="min-h-72 resize-y rounded-2xl border-transparent bg-muted p-4 font-mono text-xs leading-6"
                  value={state.encoded}
                  onChange={state.changeEncoded}
                  disabled={state.pending}
                  spellCheck={false}
                />
              </Field>
              <p className="text-xs leading-5 text-muted-foreground">
                使用 mcpServers 配置单个 MCP，支持 Streamable HTTP 和 SSE。
              </p>
            </TabsContent>
          </Tabs>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          {state.notice && (
            <p className="text-xs leading-5 text-muted-foreground">{state.notice}</p>
          )}
          {state.testSummary && (
            <p className="flex items-center gap-2 text-xs text-success-foreground" role="status">
              <CheckCircle2 width={14} height={14} aria-hidden />
              {state.testSummary}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={state.test}
              disabled={state.pending}
            >
              {!state.testing && <PlugZap width={14} height={14} aria-hidden />}
              {state.testing && (
                <LoaderCircle
                  width={14}
                  height={14}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              )}
              {!state.testing && '测试连接'}
              {state.testing && '测试中…'}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="rounded-full px-5"
                onClick={onClose}
              >
                取消
              </Button>
              <Button type="submit" className="rounded-full px-5" disabled={state.pending}>
                {!state.saving && '保存配置'}
                {state.saving && '保存中…'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
