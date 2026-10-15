import { createServer } from 'node:http';
import type { ModelRequest, TestModelServer } from './model-server.js';

export interface ApprovalTestModel extends TestModelServer {
  reviews: ModelRequest[];
}
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
const lastUserText = (messages: readonly Record<string, unknown>[]): string => {
  const user = messages
    .filter((message) => {
      return message['role'] === 'user';
    })
    .at(-1);
  const content = user?.['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown): string => {
      if (isRecord(part) && typeof part['text'] === 'string') return part['text'];
      return '';
    })
    .join('\n');
};
const isReview = (text: string): boolean => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  return (
    isRecord(value) &&
    'authorizationContext' in value &&
    isRecord(value['invocation']) &&
    typeof value['invocation']['name'] === 'string'
  );
};

/** Serves the real tool loop and an independent review request identified by its public JSON payload. */
export async function startApprovalModel(review: 'allow' | 'invalid'): Promise<ApprovalTestModel> {
  const requests: ModelRequest[] = [];
  const reviews: ModelRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.once('end', () => {
      try {
        const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!isRecord(input)) throw new Error('Invalid approval fixture request');
        const entry: ModelRequest = {
          path: request.url ?? '',
          authorization: request.headers.authorization,
          body: input,
        };
        requests.push(entry);
        const messages: Record<string, unknown>[] = [];
        if (Array.isArray(input['messages'])) {
          for (const message of input['messages']) {
            if (isRecord(message)) messages.push(message);
          }
        }
        const reviewing = isReview(lastUserText(messages));
        if (reviewing) reviews.push(entry);
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
        });
        const send = (delta: Record<string, unknown>, finish: string | null = null): void => {
          response.write(
            `data: ${JSON.stringify({ id: `approval-fixture-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: input['model'], choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
          );
        };
        send({ role: 'assistant', content: '' });
        if (reviewing) {
          let content = 'This is not a structured approval decision.';
          if (review === 'allow')
            content = JSON.stringify({
              decision: 'allow',
              reason: '本次修改只创建用户要求的工作区测试文件。',
            });
          send({ content });
          send({}, 'stop');
        } else if (
          messages.some((message) => {
            return message['role'] === 'tool';
          })
        ) {
          send({ content: '审批执行已完成。' });
          send({}, 'stop');
        } else {
          send({
            tool_calls: [
              {
                index: 0,
                id: 'approval-write-call',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: 'approved.txt',
                    content: 'Approval fixture content\n',
                    expectedHash: null,
                  }),
                },
              },
            ],
          });
          send({}, 'tool_calls');
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
  if (!address || typeof address === 'string') throw new Error('Missing approval fixture listener');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    reviews,
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
