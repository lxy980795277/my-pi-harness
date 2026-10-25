import type { FC } from 'react';
import type { McpServerView } from '@my-pi-harness/protocol';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';
import { Notice } from '@/components/ui/notice';
import { useMcpSecret } from '@/features/mcp/hooks/use-mcp-secret';

interface McpSecretDialogProps {
  server: McpServerView;
  onClose: () => void;
}
/** Secret input never shares state with public configuration or cached server facts. */
export const McpSecretDialog: FC<McpSecretDialogProps> = ({ server, onClose }) => {
  const state = useMcpSecret(server);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" closeLabel="关闭秘密设置">
        <DialogTitle>{server.name} · 秘密</DialogTitle>
        <DialogDescription>
          秘密由本机凭据存储管理，仅注入已授权的子进程。更新后需重新确认启动授权。
        </DialogDescription>
        <form className="space-y-4" onSubmit={state.submit}>
          <Field label="秘密槽" htmlFor="mcp-secret-slot">
            <SelectField
              id="mcp-secret-slot"
              ariaLabel="秘密槽"
              value={state.slotId}
              options={state.options}
              onValueChange={state.changeSlot}
              disabled={state.pending}
            />
          </Field>
          <Field label="秘密值" htmlFor="mcp-secret-value">
            <Input
              id="mcp-secret-value"
              type="password"
              value={state.value}
              onChange={state.changeValue}
              autoComplete="off"
              disabled={state.pending}
            />
          </Field>
          {state.saved && <Notice>秘密已保存。</Notice>}
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={state.remove}
              disabled={state.pending || !state.canRemove}
            >
              删除秘密并撤销连接
            </Button>
            <Button
              type="submit"
              disabled={state.pending || state.value.length === 0 || state.slotId.length === 0}
            >
              保存秘密
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
