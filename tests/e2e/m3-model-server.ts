import { createServer } from 'node:http';
import type { ModelRequest, TestModelServer } from './model-server.js';

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

/** A test-owned SSE provider observes real frozen context and asks one question per marked input. */
export async function startM3Model(): Promise<TestModelServer> {
  const requests: ModelRequest[] = [];
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
        const text = textContent(messages[latestUser]?.['content']);
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
        if (text.includes('[ask:') && toolResults.length === 0) {
          send({
            tool_calls: [
              {
                index: 0,
                id: 'call-m3-question',
                type: 'function',
                function: {
                  name: 'ask_user',
                  arguments: JSON.stringify({
                    prompt: '请选择本次执行方案',
                    options: ['方案 A', '方案 B'],
                  }),
                },
              },
            ],
          });
          send({}, 'tool_calls');
        } else {
          let answer = 'M3 会话已完成。';
          if (text.includes('附件首发')) {
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
          if (text.includes('图片首发'))
            answer = JSON.stringify(messages).includes('image_url')
              ? 'M3 图片已进入模型请求。'
              : '图片内容缺失';
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
