import type { FC } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import type { RemoteMcpEditorState } from '@/features/mcp/types/remote-mcp-editor';

interface RemoteMcpFormProps {
  state: RemoteMcpEditorState;
}

const TRANSPORT_OPTIONS = [
  { value: 'streamable-http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE' },
];
const INPUT_CLASS = 'h-11 rounded-xl border-transparent bg-muted px-3 text-sm';

/** The form exposes endpoint and header fields without revealing saved credential values. */
export const RemoteMcpForm: FC<RemoteMcpFormProps> = ({ state }) => {
  return (
    <div className="space-y-5">
      <Field label="MCP ID" htmlFor="remote-mcp-id">
        <Input
          id="remote-mcp-id"
          name="mcpId"
          value={state.draft.mcpId}
          onChange={state.changeField}
          placeholder="例如：docs"
          maxLength={120}
          required
          disabled={state.pending}
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="连接方式" htmlFor="remote-mcp-transport">
        <SelectField
          id="remote-mcp-transport"
          ariaLabel="MCP 连接方式"
          value={state.draft.transport}
          onValueChange={state.changeTransport}
          options={TRANSPORT_OPTIONS}
          disabled={state.pending}
          className="h-11 rounded-xl border-transparent bg-muted px-3 text-sm"
        />
      </Field>
      <Field label="服务器地址" htmlFor="remote-mcp-endpoint">
        <Input
          id="remote-mcp-endpoint"
          name="endpoint"
          value={state.draft.endpoint}
          onChange={state.changeField}
          placeholder="https://example.com/mcp"
          required
          disabled={state.pending}
          className={INPUT_CLASS}
        />
      </Field>
      <div className="space-y-3">
        <p className="text-xs font-medium">自定义 Headers</p>
        {state.headerRows.map((row) => {
          return (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                aria-label="Header 名称"
                value={row.name}
                onChange={row.changeName}
                placeholder="Authorization"
                autoComplete="off"
                disabled={state.pending}
                className={INPUT_CLASS}
              />
              <Input
                aria-label="Header 值"
                type={row.inputType}
                value={row.value}
                onChange={row.changeValue}
                placeholder={row.placeholder}
                autoComplete="off"
                disabled={state.pending}
                className={INPUT_CLASS}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full bg-muted"
                aria-label="删除请求头"
                onClick={row.remove}
                disabled={state.pending}
              >
                <Trash2 width={15} height={15} aria-hidden />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          className="rounded-full bg-muted px-3"
          onClick={state.addHeader}
          disabled={state.pending}
        >
          <Plus width={15} height={15} aria-hidden />
          添加
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          已保存的请求头值不回显，留空保留。
        </p>
      </div>
    </div>
  );
};
