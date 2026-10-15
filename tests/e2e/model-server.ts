import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

/** Synthetic provider records real Pi HTTP requests without accessing an external model. */
export interface ModelRequest {
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}
export interface TestModelServer {
  origin: string;
  requests: ModelRequest[];
  close(): Promise<void>;
}

/** Create one loopback provider per test, with delayed replies available for cancellation. */
export async function startTestModel(): Promise<TestModelServer> {
  const requests: ModelRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.once('end', () => {
      void (async () => {
        const raw: unknown = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
          throw new Error('Invalid model request');
        const body = raw as Record<string, unknown>;
        requests.push({
          path: request.url ?? '',
          authorization: request.headers.authorization,
          body,
        });
        const messages = Array.isArray(body['messages']) ? body['messages'] : [];
        const user = messages
          .filter(
            (value: unknown) =>
              typeof value === 'object' &&
              value !== null &&
              'role' in value &&
              value.role === 'user',
          )
          .at(-1) as { content?: unknown } | undefined;
        const text = typeof user?.content === 'string' ? user.content : 'OK';
        if (text.includes('失败测试')) {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'Synthetic provider error' } }));
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
        });
        const chunk = (delta: Record<string, string>, finish: string | null = null): void => {
          if (!response.destroyed && !response.writableEnded)
            response.write(
              `data: ${JSON.stringify({ id: 'synthetic-completion', object: 'chat.completion.chunk', created: 1, model: body['model'], choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
            );
        };
        chunk({ role: 'assistant', content: '' });
        chunk({ content: '响应：' });
        await delay(text.includes('慢速') ? 3000 : 100);
        if (response.destroyed) return;
        chunk({ content: text });
        chunk({}, 'stop');
        response.end('data: [DONE]\n\n');
      })().catch(() => {
        response.destroy();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No model listener');
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
