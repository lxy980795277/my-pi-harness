import {
  McpServerInputSchema,
  type McpServerInput,
  type McpServerView,
} from '@my-pi-harness/protocol';
import type { McpServerForm } from '@/features/mcp/types/mcp';
import { parseResponse } from '@/utils/parse-response';

/** Form fields never contain credential values, including when editing an existing server. */
export const mcpServerForm = (server: McpServerView | null): McpServerForm => {
  if (server === null) {
    return {
      name: '',
      workspaceId: '',
      command: '',
      args: '[]',
      publicEnvironment: '{}',
      secretSlots: '[]',
    };
  }
  return {
    name: server.name,
    workspaceId: server.workspaceId,
    command: server.command,
    args: JSON.stringify(server.args, null, 2),
    publicEnvironment: JSON.stringify(server.publicEnvironment, null, 2),
    secretSlots: JSON.stringify(
      server.secretSlots.map((slot) => {
        return { slotId: slot.slotId, environmentName: slot.environmentName };
      }),
      null,
      2,
    ),
  };
};

const parseField = (text: string, label: string): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new Error(`${label}的 JSON 格式无效。`);
  }
};

/** Parses explicit public configuration without shell tokenization or credential values. */
export const parseMcpServerForm = (form: McpServerForm): McpServerInput => {
  return parseResponse(
    McpServerInputSchema,
    {
      name: form.name.trim(),
      workspaceId: form.workspaceId,
      command: form.command,
      args: parseField(form.args, '启动参数'),
      publicEnvironment: parseField(form.publicEnvironment, '公开环境变量'),
      secretSlots: parseField(form.secretSlots, '秘密槽'),
    },
    '请检查名称、工作区、启动程序、公开环境变量及秘密槽格式。',
  );
};
