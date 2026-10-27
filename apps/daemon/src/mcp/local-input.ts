import { isAbsolute } from 'node:path';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import type { McpServerInput } from '@my-pi-harness/protocol';

const forbiddenEnvironment = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NODE_OPTIONS',
  'NODE_PATH',
  'BASH_ENV',
  'ENV',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'SHELL',
  'ZDOTDIR',
  'PYTHONPATH',
  'PYTHONHOME',
  'RUBYOPT',
  'PERL5OPT',
]);
const MAX_ENVIRONMENT_VARIABLES = 64;

function fail(code: string, message: string): never {
  throw new RuntimeError(code, message);
}

/** Validate local startup configuration before storing or previewing a server. */
export function validateLocalMcpInput(input: McpServerInput): McpServerInput {
  if (!isAbsolute(input.command) || input.command.includes('\0'))
    fail('MCP_COMMAND_INVALID', '请选择可检查的绝对程序路径。');
  const name = input.name.trim();
  if (!name) fail('MCP_NAME_INVALID', 'MCP服务器名称不能为空。');
  const names = new Set(Object.keys(input.publicEnvironment));
  if (names.size + input.secretSlots.length > MAX_ENVIRONMENT_VARIABLES)
    fail('MCP_ENVIRONMENT_INVALID', '环境变量数量超过限制。');
  const slots = new Set<string>();
  for (const slot of input.secretSlots) {
    if (slots.has(slot.slotId) || names.has(slot.environmentName))
      fail('MCP_ENVIRONMENT_INVALID', '秘密槽位或环境变量名称重复。');
    slots.add(slot.slotId);
    names.add(slot.environmentName);
  }
  for (const key of names) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      forbiddenEnvironment.has(key.toUpperCase()) ||
      key.startsWith('DYLD_') ||
      key.startsWith('LD_')
    )
      fail('MCP_ENVIRONMENT_INVALID', '配置不能覆盖宿主的启动控制环境变量。');
  }
  for (const value of [...input.args, ...Object.values(input.publicEnvironment)]) {
    if (value.includes('\0')) fail('MCP_ENVIRONMENT_INVALID', '配置不能包含空字符。');
  }
  return { ...input, name };
}
