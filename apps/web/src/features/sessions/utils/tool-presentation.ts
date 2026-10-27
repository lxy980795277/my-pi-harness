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
  Plug,
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
  tool_search: { name: '检索工具', Icon: Search, argument: 'query' },
  load_tools: { name: '加载工具', Icon: Plug },
  skill_search: { name: '检索 Skill', Icon: Search, argument: 'query' },
  load_skill: { name: '加载 Skill', Icon: FileText },
  read_skill_resource: { name: '读取 Skill 资源', Icon: FileText, argument: 'path' },
  request_skill_tools: { name: '申请 Skill 工具授权', Icon: Plug },
  revoke_skill_tools: { name: '撤销 Skill 工具授权', Icon: Undo2 },
  office_docx: { name: 'Word 文档', Icon: FileText, argument: 'output' },
  office_pdf: { name: 'PDF 文档', Icon: FileText, argument: 'output' },
  office_xlsx: { name: '工作簿', Icon: FileText, argument: 'output' },
  office_pptx: { name: '演示文稿', Icon: FileText, argument: 'output' },
  office_inspect: { name: '检查文档', Icon: Search, argument: 'source' },
  office_render: { name: '渲染文档', Icon: FileText, argument: 'source' },
  pdf_read_pages: { name: '读取 PDF 页图', Icon: FileText, argument: 'source' },
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
  unknown: '结果未知',
};

const conciseSummary = (text: string): string => {
  return text.replace(/\s+/gu, ' ').trim();
};

const toolSummary = (tool: ToolCallView, definition: ToolDefinition): string => {
  if (tool.status === 'unknown') {
    return '操作可能已生效，需要核验';
  }
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
  let sourceLabel = '调用未接受';
  let fingerprint: string | null = null;
  if (tool.binding.kind === 'accepted') {
    fingerprint = tool.binding.fingerprint;
    const source = tool.binding.source;
    if (source.kind === 'mcp') {
      definition = { name: source.remoteToolName, Icon: Plug };
      sourceLabel = `MCP · ${source.serverId} · revision ${source.serverRevision} · ${source.remoteToolName}`;
    } else if (source.kind === 'session') {
      sourceLabel = '会话工具';
    } else {
      sourceLabel = '工作区工具';
    }
  }
  let dispatchLabel = '尚未派发';
  if (tool.binding.kind === 'accepted' && tool.binding.source.kind !== 'mcp') {
    dispatchLabel = '内部工具';
  }
  if (tool.dispatch.state === 'not_started') {
    dispatchLabel = '尚未派发';
  }
  if (tool.dispatch.state === 'may_have_started') {
    dispatchLabel = '可能已经派发';
    if (tool.dispatch.confirmedNotWritten === true) {
      dispatchLabel = '已确认未写入';
    }
  }
  let statusClassName = 'text-muted-foreground';
  if (tool.status === 'failed' || tool.status === 'interrupted') {
    statusClassName = 'text-error-solid';
  } else if (
    tool.status === 'awaiting_approval' ||
    tool.status === 'denied' ||
    tool.status === 'unknown'
  ) {
    statusClassName = 'text-warning-solid';
  }
  return {
    ...definition,
    sourceLabel,
    fingerprint,
    dispatchLabel,
    unknown: tool.status === 'unknown',
    summary: toolSummary(tool, definition),
    statusLabel: TOOL_STATUS_LABELS[tool.status],
    statusClassName,
    showStatus:
      tool.status !== 'completed' && tool.status !== 'running' && tool.status !== 'reviewing',
    busy: tool.status === 'running' || tool.status === 'reviewing',
  };
};
