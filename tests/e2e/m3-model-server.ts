import { createServer } from 'node:http';
import type { ModelRequest, TestModelServer } from './model-server.js';

const CURRENT_RUN_TASK_PREFIX =
  'Current Run user task (retained across compaction; tool permissions remain unchanged):\n';

const record = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
const textContent = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part: unknown): string => {
      if (record(part) && typeof part['text'] === 'string') return part['text'];
      return '';
    })
    .join('\n');
};

/** Compacted task input remains in the harness's explicit JSON-valued system section. */
const currentTaskText = (messages: Record<string, unknown>[], latestUser: number): string => {
  if (latestUser >= 0) return textContent(messages[latestUser]?.['content']);
  for (const message of messages) {
    if (message['role'] !== 'system') continue;
    const content = textContent(message['content']);
    const marker = content.lastIndexOf(CURRENT_RUN_TASK_PREFIX);
    if (marker < 0) continue;
    const parsed: unknown = JSON.parse(content.slice(marker + CURRENT_RUN_TASK_PREFIX.length));
    if (typeof parsed !== 'string') throw new Error('Invalid retained M3 task input');
    return parsed;
  }
  return '';
};

/** A test-owned SSE provider observes real frozen context and asks one question per marked input. */
export async function startM3Model(): Promise<TestModelServer> {
  const requests: ModelRequest[] = [];
  let planRequests = 0;
  let summaryRequests = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.once('end', () => {
      try {
        const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!record(input)) throw new Error('Invalid M3 model request');
        requests.push({
          path: request.url ?? '',
          authorization: request.headers.authorization,
          body: input,
        });
        const messages: Record<string, unknown>[] = [];
        if (Array.isArray(input['messages'])) {
          for (const message of input['messages']) {
            if (record(message)) messages.push(message);
          }
        }
        let latestUser = -1;
        for (let index = 0; index < messages.length; index++) {
          if (messages[index]?.['role'] === 'user') latestUser = index;
        }
        const text = currentTaskText(messages, latestUser);
        const toolResults = messages.slice(latestUser + 1).filter((message) => {
          return message['role'] === 'tool';
        });
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
        });
        const send = (delta: Record<string, unknown>, finish: string | null = null): void => {
          response.write(
            `data: ${JSON.stringify({ id: `m3-fixture-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: input['model'], choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
          );
        };
        send({ role: 'assistant', content: '' });
        const callTool = (name: string, parameters: Record<string, unknown>): void => {
          send({
            tool_calls: [
              {
                index: 0,
                id: `call-m3-${requests.length}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(parameters) },
              },
            ],
          });
          send({}, 'tool_calls');
        };
        if (!Array.isArray(input['tools'])) {
          summaryRequests++;
          send({
            content: JSON.stringify({
              objective: 'M3 摘要目标',
              constraints: ['保留用户约束'],
              decisions: [`摘要版本 ${summaryRequests}`],
              completed: ['已读取历史消息'],
              pending: ['继续后续任务'],
              blockers: [],
              nextAction: `继续第 ${summaryRequests} 阶段`,
            }),
          });
          send({}, 'stop');
        } else if (text.includes('[plan:review]') && planRequests < 4) {
          const stage = planRequests++;
          if (stage < 2) {
            let content = '先读取资料，再整理结果。';
            let title = '第一份计划';
            if (stage === 1) {
              content = '先核对来源，再整理结果，并记录依据。';
              title = '修订后的计划';
            }
            callTool('update_plan', {
              title,
              content,
              steps: [{ id: 'organize', title: '整理资料', status: 'pending' }],
            });
          } else if (stage === 2) {
            callTool('update_todos', {
              todos: [
                {
                  id: 'summary-task',
                  title: '整理资料',
                  status: 'completed',
                  planStepId: 'organize',
                  evidenceToolCallIds: [],
                  completionNote: '已根据本次对话完成纯文本资料整理。',
                },
              ],
            });
          } else {
            callTool('update_plan_steps', { steps: [{ id: 'organize', status: 'completed' }] });
          }
        } else if (text.includes('[ask:') && toolResults.length === 0) {
          send({
            tool_calls: [
              {
                index: 0,
                id: 'call-m3-question',
                type: 'function',
                function: {
                  name: 'ask_user',
                  arguments: JSON.stringify({
                    questions: [
                      {
                        id: 'approach',
                        header: '方案',
                        prompt: '请选择本次执行方案',
                        options: [
                          { id: 'a', label: '方案 A', description: '先读资料' },
                          { id: 'b', label: '方案 B', description: '先列问题' },
                        ],
                        multiSelect: false,
                        allowCustomInput: true,
                      },
                      {
                        id: 'priorities',
                        header: '重点',
                        prompt: '选择关注重点',
                        options: [
                          { id: 'speed', label: '速度', description: '' },
                          { id: 'quality', label: '质量', description: '' },
                        ],
                        multiSelect: true,
                        allowCustomInput: false,
                      },
                    ],
                  }),
                },
              },
            ],
          });
          send({}, 'tool_calls');
        } else {
          let answer = 'M3 会话已完成。';
          if (
            text.includes('附件首发') ||
            JSON.stringify(messages).includes('ATTACHMENT-CONTENT-M3')
          ) {
            answer = JSON.stringify(messages).includes('ATTACHMENT-CONTENT-M3')
              ? '已读取附件：ATTACHMENT-CONTENT-M3'
              : '附件内容缺失';
          }
          if (text.includes('检查规则与引用')) {
            const context = JSON.stringify(messages);
            answer = ['M3-ROOT-RULE', 'M3-NESTED-RULE', 'M3-SELECTED-LINE'].every((marker) => {
              return context.includes(marker);
            })
              ? '规则和文件片段已进入模型上下文。'
              : '规则或引用内容缺失';
          }
          if (text.includes('图片首发') || JSON.stringify(messages).includes('image_url'))
            answer = JSON.stringify(messages).includes('image_url')
              ? 'M3 图片已进入模型请求。'
              : '图片内容缺失';
          if (text.includes('[plan:review]')) answer = 'M3 计划已在同一次运行中完成。';
          if (text.includes('[ask:answer]'))
            answer = `Agent 收到回答：${toolResults
              .map((message) => {
                return textContent(message['content']);
              })
              .join('\n')}`;
          if (text.includes('[ask:cancel]')) answer = '取消提问后已继续。';
          send({ content: answer });
          send({}, 'stop');
        }
        response.end('data: [DONE]\n\n');
      } catch {
        response.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing M3 fixture listener');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
