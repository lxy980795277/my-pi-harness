import type { ToolCallView } from '@my-pi-harness/protocol';
import {
  ClipboardList,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderSearch,
  Globe,
  History,
  ListChecks,
  ListTodo,
  MessageCircleQuestion,
  RotateCcw,
  Search,
  Terminal,
  Undo2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ToolPresentation } from '@/features/sessions/types/tool';

interface ToolDefinition {
  name: string;
  Icon: LucideIcon;
  argument?: string;
}

const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  read_file: { name: '读取文件', Icon: FileText, argument: 'path' },
  list_files: { name: '浏览目录', Icon: FolderSearch, argument: 'path' },
  search_files: { name: '搜索文件', Icon: Search, argument: 'query' },
  write_file: { name: '写入文件', Icon: FilePlus2, argument: 'path' },
  edit_file: { name: '编辑文件', Icon: FilePenLine, argument: 'path' },
  shell: { name: '执行命令', Icon: Terminal, argument: 'command' },
  web_fetch: { name: '网页获取', Icon: Globe, argument: 'url' },
  ask_user: { name: '询问用户', Icon: MessageCircleQuestion },
  update_plan: { name: '提交计划', Icon: ClipboardList, argument: 'title' },
  update_plan_steps: { name: '更新计划', Icon: ListChecks },
  update_todos: { name: '更新任务', Icon: ListTodo },
  search_session_history: { name: '搜索对话', Icon: History, argument: 'query' },
  restore_context_checkpoint: { name: '恢复上下文', Icon: Undo2, argument: 'checkpointId' },
  reset_working_state: { name: '重置工作状态', Icon: RotateCcw },
};

const TOOL_STATUS_LABELS: Record<ToolCallView['status'], string> = {
  reviewing: 'AI 复核中',
  awaiting_approval: '等待批准',
  running: '执行中',
  completed: '已完成',
  failed: '执行失败',
  denied: '已拒绝',
  cancelled: '已取消',
  interrupted: '执行中断',
};

const conciseSummary = (text: string): string => {
  return text.replace(/\s+/gu, ' ').trim();
};

const toolSummary = (tool: ToolCallView, definition: ToolDefinition): string => {
  if (
    (tool.status === 'failed' || tool.status === 'denied' || tool.status === 'interrupted') &&
    tool.result !== null
  ) {
    return conciseSummary(tool.result.split('\n')[0] ?? '');
  }
  if (definition.argument !== undefined) {
    const value = tool.arguments[definition.argument];
    if (typeof value === 'string' && value.trim().length > 0) {
      return conciseSummary(value);
    }
  }
  switch (tool.name) {
    case 'list_files':
      return '.';
    case 'ask_user': {
      const questions = tool.arguments['questions'];
      if (Array.isArray(questions)) {
        return `${questions.length} 个问题`;
      }
      break;
    }
    case 'update_plan_steps': {
      const steps = tool.arguments['steps'];
      if (Array.isArray(steps)) {
        return `${steps.length} 个步骤`;
      }
      break;
    }
    case 'update_todos': {
      const todos = tool.arguments['todos'];
      if (Array.isArray(todos)) {
        return `${todos.length} 项任务`;
      }
      break;
    }
    case 'restore_context_checkpoint': {
      const steps = tool.arguments['stepsBack'];
      if (typeof steps === 'number') {
        return `回退 ${steps} 个检查点`;
      }
      return '上一个检查点';
    }
    case 'reset_working_state':
      return '计划与任务';
  }
  if (tool.summary === tool.name) {
    return '';
  }
  return conciseSummary(tool.summary);
};

/** Collapsed rows identify the requested target; exact recorded values remain in their details. */
export const toolPresentation = (tool: ToolCallView): ToolPresentation => {
  let definition = TOOL_DEFINITIONS[tool.name];
  if (definition === undefined) {
    definition = { name: tool.name, Icon: Wrench };
  }
  let statusClassName = 'text-muted-foreground';
  if (tool.status === 'failed' || tool.status === 'interrupted') {
    statusClassName = 'text-error-solid';
  } else if (tool.status === 'awaiting_approval' || tool.status === 'denied') {
    statusClassName = 'text-warning-solid';
  }
  return {
    ...definition,
    summary: toolSummary(tool, definition),
    statusLabel: TOOL_STATUS_LABELS[tool.status],
    statusClassName,
    showStatus:
      tool.status !== 'completed' && tool.status !== 'running' && tool.status !== 'reviewing',
    busy: tool.status === 'running' || tool.status === 'reviewing',
  };
};
