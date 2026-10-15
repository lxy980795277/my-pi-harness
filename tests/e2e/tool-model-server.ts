import { createServer } from 'node:http';
import type { TestModelServer, ModelRequest } from './model-server.js';

/** Emits one real OpenAI tool call, then observes Pi's HTTP tool result before answering. */
export async function startToolModel(): Promise<TestModelServer> {
  const requests: ModelRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.once('end', () => {
      try {
        const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof input !== 'object' || input === null || Array.isArray(input))
          throw new Error('Invalid fixture request');
        const body = input as Record<string, unknown>;
        requests.push({
          path: request.url ?? '',
          authorization: request.headers.authorization,
          body,
        });
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const send = (delta: Record<string, unknown>, finish: string | null = null): void => {
          response.write(
            `data: ${JSON.stringify({ id: 'fixture-tool-completion', object: 'chat.completion.chunk', created: 1, model: body['model'], choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
          );
        };
        send({ role: 'assistant', content: '' });
        if (requests.length === 1) {
          send({
            tool_calls: [
              {
                index: 0,
                id: 'call-create-fixture',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: 'created.txt',
                    content: 'Workspace tool result\n',
                    expectedHash: null,
                  }),
                },
              },
            ],
          });
          send({}, 'tool_calls');
        } else {
          send({ content: '已收到工具执行结果。' });
          send({}, 'stop');
        }
        response.end('data: [DONE]\n\n');
      } catch {
        response.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
