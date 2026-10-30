import { createServer } from 'node:http';
import type { ModelRequest, TestModelServer } from './model-server.js';

interface M5ModelOptions {
  webFetchUrl?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function content(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part: unknown) => {
      if (record(part) && typeof part['text'] === 'string') return part['text'];
      return '';
    })
    .join('\n');
}

function isReview(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return (
      record(value) &&
      'authorizationContext' in value &&
      record(value['invocation']) &&
      value['invocation']['name'] === 'web_fetch'
    );
  } catch {
    return false;
  }
}

/** The provider follows explicit task tool results through real Pi HTTP requests. */
export async function startM5Model(options: M5ModelOptions = {}): Promise<TestModelServer> {
  const requests: ModelRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.once('end', () => {
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!record(body)) throw new Error('Invalid M5 fixture request');
        requests.push({
          path: request.url ?? '',
          authorization: request.headers.authorization,
          body,
        });
        const messages: Record<string, unknown>[] = [];
        if (Array.isArray(body['messages'])) {
          for (const message of body['messages']) if (record(message)) messages.push(message);
        }
        const users = messages.filter((message) => message['role'] === 'user');
        const user = content(users.at(-1)?.['content']);
        const serialized = JSON.stringify(messages);
        const results = messages.filter((message) => message['role'] === 'tool');
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
        });
        const send = (delta: Record<string, unknown>, finish: string | null = null): void => {
          response.write(
            `data: ${JSON.stringify({
              id: `m5-${requests.length}`,
              object: 'chat.completion.chunk',
              created: 1,
              model: body['model'],
              choices: [{ index: 0, delta, finish_reason: finish }],
            })}\n\n`,
          );
        };
        const tool = (name: string, args: Record<string, unknown>): void => {
          send({
            tool_calls: [
              {
                index: 0,
                id: `m5-call-${requests.length}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          });
          send({}, 'tool_calls');
        };
        const answer = (text: string): void => {
          send({ content: text });
          send({}, 'stop');
        };
        send({ role: 'assistant', content: '' });
        if (isReview(user)) {
          answer(
            JSON.stringify({
              decision: 'allow',
              reason: '用户要求读取本次受控资料，GET 无写入副作用。',
            }),
          );
        } else if (
          serialized.includes('M5-CHILD-ISOLATED') &&
          !serialized.includes('M5-ROOT-SECRET')
        ) {
          if (user.includes('[hold]')) return;
          if (user.includes('[fetch]') && results.length === 0) {
            if (options.webFetchUrl === undefined) throw new Error('Missing M5 fixture read URL');
            tool('web_fetch', { url: options.webFetchUrl, method: 'GET' });
          } else if (user.includes('[fetch]') && !serialized.includes('M5-READONLY-GET-OK')) {
            answer('M5-CHILD-FETCH-FAILED');
          } else if (user.includes('[ask]') && results.length === 0) {
            tool('ask_user', {
              questions: [
                {
                  id: 'confirmation',
                  header: '确认资料',
                  prompt: '是否已核对任务资料？',
                  options: [{ id: 'confirmed', label: '核对完成', description: '继续任务' }],
                  multiSelect: false,
                  allowCustomInput: true,
                },
              ],
            });
          } else if (user.includes('[mail]') && results.length === 0) {
            tool('send_agent_message', {
              target: { kind: 'parent' },
              text: 'M5-AGENT-COMMUNICATION',
            });
          } else answer('M5-CHILD-RESULT：只读任务已独立完成。');
        } else if (serialized.includes('M5-ROOT-SECRET')) {
          if (results.length === 0) {
            let task = 'M5-CHILD-ISOLATED：核对任务，返回简短结论。';
            if (user.includes('[hold]')) task += ' [hold]';
            if (user.includes('[ask]')) task += ' [ask]';
            if (user.includes('[mail]')) task += ' [mail]';
            if (user.includes('[fetch]')) task += ' [fetch]';
            tool('spawn_agent', { title: '独立核对', task, roleId: 'researcher' });
          } else if (serialized.includes('M5-CHILD-RESULT')) {
            answer('M5 汇总完成：M5-CHILD-RESULT 已核对。');
          } else if (results.length > 1 && serialized.includes('cancelled')) {
            answer('M5 子任务已停止。');
          } else {
            const first: unknown = JSON.parse(content(results[0]?.['content']));
            if (!record(first) || typeof first['id'] !== 'string')
              throw new Error('Spawn result is missing its task id');
            tool('wait_agents', { taskIds: [first['id']], timeoutMs: 60_000 });
          }
        } else answer('M5 fixture ready.');
        response.write(
          `data: ${JSON.stringify({
            id: `m5-${requests.length}`,
            object: 'chat.completion.chunk',
            created: 1,
            model: body['model'],
            choices: [],
            usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
          })}\n\n`,
        );
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
  if (address === null || typeof address === 'string') throw new Error('Missing fixture listener');
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
