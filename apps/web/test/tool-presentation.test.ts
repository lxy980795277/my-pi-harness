import type { ToolCallView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { toolPresentation } from '../src/features/sessions/utils/tool-presentation';

const tool = (overrides: Partial<ToolCallView> = {}): ToolCallView => {
  return {
    id: 'tool',
    sessionId: 'session',
    runId: 'run',
    branchId: 'branch',
    afterMessageId: 'assistant',
    name: 'read_file',
    arguments: { path: 'src/main.ts' },
    status: 'completed',
    summary: 'Read 25 lines',
    result: 'Recorded contents',
    diff: null,
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
};

describe('compact tool presentation', () => {
  it('keeps the requested target visible after the recorded execution summary changes', () => {
    const pending = tool({ status: 'running', summary: 'read_file: src/main.ts' });
    const completed = tool();
    expect(toolPresentation(pending).summary).toBe('src/main.ts');
    expect(toolPresentation(completed).summary).toBe('src/main.ts');
    expect(toolPresentation(completed)).toMatchObject({
      name: '读取文件',
      showStatus: false,
      busy: false,
    });
  });

  it('summarizes a mutation by its path without putting the file contents in the row', () => {
    const write = tool({
      name: 'write_file',
      arguments: { path: 'notes.md', content: 'Long file payload', expectedHash: null },
    });
    expect(toolPresentation(write)).toMatchObject({ name: '写入文件', summary: 'notes.md' });
    expect(write.arguments['content']).toBe('Long file payload');
  });

  it('normalizes only the visible command preview and preserves exact multiline arguments', () => {
    const command = 'printf first\n\n  printf second';
    const shell = tool({ name: 'shell', arguments: { command }, status: 'running' });
    expect(toolPresentation(shell)).toMatchObject({
      name: '执行命令',
      summary: 'printf first printf second',
      busy: true,
      showStatus: false,
      statusLabel: '执行中',
    });
    expect(shell.arguments['command']).toBe(command);
  });

  it('shows the URL for a web request and its failure reason when the request fails', () => {
    const request = tool({
      name: 'web_fetch',
      arguments: { url: 'https://example.com/report' },
    });
    expect(toolPresentation(request)).toMatchObject({
      name: '网页获取',
      summary: 'https://example.com/report',
    });
    expect(
      toolPresentation({ ...request, status: 'failed', result: 'HTTP 418\nResponse details' }),
    ).toMatchObject({
      summary: 'HTTP 418',
      statusLabel: '执行失败',
      showStatus: true,
    });
  });

  it('keeps review and user approval distinguishable while both operations are pending', () => {
    expect(toolPresentation(tool({ status: 'reviewing' }))).toMatchObject({
      busy: true,
      statusLabel: 'AI 复核中',
      showStatus: false,
    });
    expect(toolPresentation(tool({ status: 'awaiting_approval' }))).toMatchObject({
      busy: false,
      statusLabel: '等待批准',
      showStatus: true,
    });
  });

  it('summarizes questions and task updates without exposing their full structures', () => {
    expect(
      toolPresentation(
        tool({ name: 'ask_user', arguments: { questions: [{ id: 'first' }, { id: 'second' }] } }),
      ),
    ).toMatchObject({ name: '询问用户', summary: '2 个问题' });
    expect(
      toolPresentation(tool({ name: 'update_todos', arguments: { todos: [] } })),
    ).toMatchObject({ name: '更新任务', summary: '0 项任务' });
    expect(
      toolPresentation(tool({ name: 'update_plan_steps', arguments: { steps: [{ id: 'one' }] } })),
    ).toMatchObject({ name: '更新计划', summary: '1 个步骤' });
  });

  it('provides meaningful targets when directory and checkpoint arguments are omitted', () => {
    expect(toolPresentation(tool({ name: 'list_files', arguments: {} })).summary).toBe('.');
    expect(
      toolPresentation(tool({ name: 'restore_context_checkpoint', arguments: {} })).summary,
    ).toBe('上一个检查点');
    expect(
      toolPresentation(tool({ name: 'restore_context_checkpoint', arguments: { stepsBack: 2 } }))
        .summary,
    ).toBe('回退 2 个检查点');
  });

  it('keeps an unrecognized recorded tool readable without duplicating its name as a summary', () => {
    const unknown = tool({ name: 'future_tool', summary: 'future_tool', arguments: {} });
    expect(toolPresentation(unknown)).toMatchObject({ name: 'future_tool', summary: '' });
    expect(toolPresentation({ ...unknown, summary: ' A recorded\nsummary ' }).summary).toBe(
      'A recorded summary',
    );
  });
});
