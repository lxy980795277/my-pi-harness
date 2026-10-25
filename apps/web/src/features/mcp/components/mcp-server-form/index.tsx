import type { FC } from 'react';
import type { McpServerView } from '@my-pi-harness/protocol';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SelectField } from '@/components/ui/select-field';
import { Notice } from '@/components/ui/notice';
import { useMcpServerForm } from '@/features/mcp/hooks/use-mcp-server-form';

interface McpServerFormProps {
  server: McpServerView | null;
  onClose: () => void;
}

/** Public startup settings are separate from the credential and startup authorization dialogs. */
export const McpServerForm: FC<McpServerFormProps> = ({ server, onClose }) => {
  const state = useMcpServerForm(server, onClose);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-auto" closeLabel="关闭 MCP 配置">
        <DialogTitle>MCP Server</DialogTitle>
        <DialogDescription>保存本地 stdio 程序配置。保存后需单独确认启动授权。</DialogDescription>
        <form className="space-y-4" onSubmit={state.submit}>
          <Field label="名称" htmlFor="mcp-name">
            <Input
              id="mcp-name"
              name="name"
              value={state.form.name}
              onChange={state.changeField}
              required
              disabled={state.pending}
            />
          </Field>
          <Field label="工作区" htmlFor="mcp-workspace">
            <SelectField
              id="mcp-workspace"
              ariaLabel="MCP 工作区"
              value={state.form.workspaceId}
              options={state.workspaceOptions}
              onValueChange={state.changeWorkspace}
              disabled={state.pending}
            />
          </Field>
          <Field label="启动程序" htmlFor="mcp-command">
            <Input
              id="mcp-command"
              name="command"
              value={state.form.command}
              onChange={state.changeField}
              required
              disabled={state.pending}
              placeholder="程序路径或命令"
            />
          </Field>
          <Field
            label="启动参数"
            htmlFor="mcp-args"
            description="JSON 字符串数组，按原样传递，不经过 Shell。"
          >
            <Textarea
              id="mcp-args"
              name="args"
              value={state.form.args}
              onChange={state.changeField}
              disabled={state.pending}
              rows={3}
            />
          </Field>
          <Field
            label="公开环境变量"
            htmlFor="mcp-public-environment"
            description="JSON 对象。此处只填写公开值；Token 和密钥请使用秘密槽。"
          >
            <Textarea
              id="mcp-public-environment"
              name="publicEnvironment"
              value={state.form.publicEnvironment}
              onChange={state.changeField}
              disabled={state.pending}
              rows={3}
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="秘密槽"
            htmlFor="mcp-secret-slots"
            description="JSON 数组，仅定义 slotId 和 environmentName；保存后单独写入秘密。"
          >
            <Textarea
              id="mcp-secret-slots"
              name="secretSlots"
              value={state.form.secretSlots}
              onChange={state.changeField}
              disabled={state.pending}
              rows={2}
              placeholder='[{"slotId":"api-key","environmentName":"API_KEY"}]'
            />
          </Field>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={state.pending}>
              取消
            </Button>
            <Button type="submit" disabled={state.pending}>
              保存配置
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
