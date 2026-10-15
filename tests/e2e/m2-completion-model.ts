import { createServer } from 'node:http';
import type { ModelRequest, TestModelServer } from './model-server.js';

export interface ToolSequenceStep {
  name: string;
  arguments: Record<string, unknown>;
}

/** Every assistant round reuses call_0; public call identity must be owned by the runtime. */
export async function startToolSequenceModel(
  steps: readonly ToolSequenceStep[],
  finalText: string,
): Promise<TestModelServer> {
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
        const step = steps[requests.length];
        requests.push({
          path: request.url ?? '',
          authorization: request.headers.authorization,
          body,
        });
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const send = (delta: Record<string, unknown>, finish: string | null = null): void => {
          response.write(
            `data: ${JSON.stringify({ id: `fixture-tool-round-${requests.length}`, object: 'chat.completion.chunk', created: requests.length, model: body['model'], choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
          );
        };
        send({ role: 'assistant', content: '' });
        if (step) {
          send({
            tool_calls: [
              {
                index: 0,
                id: 'call_0',
                type: 'function',
                function: { name: step.name, arguments: JSON.stringify(step.arguments) },
              },
            ],
          });
          send({}, 'tool_calls');
        } else {
          send({ content: finalText });
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
  if (!address || typeof address === 'string') throw new Error('Missing sequence model listener');
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
