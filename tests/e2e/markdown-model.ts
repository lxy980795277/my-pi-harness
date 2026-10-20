import { createServer } from 'node:http';
import type { TestModelServer } from './model-server.js';

interface MarkdownModel extends Pick<TestModelServer, 'origin' | 'close'> {
  readonly requests: number;
  readonly closedResponses: number;
  start: () => void;
  finish: () => void;
}

/** Stream a controlled Markdown prefix through the real Pi provider before releasing its suffix. */
export async function startMarkdownModel(
  prefix: string,
  suffix: string,
  options: { pauseBeforeStart?: boolean } = {},
): Promise<MarkdownModel> {
  let start = (): void => undefined;
  const startGate = new Promise<void>((resolve) => {
    start = resolve;
  });
  if (!options.pauseBeforeStart) start();
  let requests = 0;
  let closedResponses = 0;
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server = createServer((request, response) => {
    response.once('close', () => {
      closedResponses += 1;
    });
    const reply = async (): Promise<void> => {
      for await (const _chunk of request) {
        // Consume the provider request before responding; this fixture has no model-side assertions.
      }
      requests += 1;
      await startGate;
      if (response.destroyed) return;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
      });
      const chunk = (delta: Record<string, string>, reason: string | null = null): void => {
        if (response.destroyed || response.writableEnded) return;
        response.write(
          `data: ${JSON.stringify({
            id: 'markdown-completion',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'chat-model',
            choices: [{ index: 0, delta, finish_reason: reason }],
          })}\n\n`,
        );
      };
      chunk({ role: 'assistant', content: '' });
      chunk({ content: prefix });
      await gate;
      if (response.destroyed) return;
      chunk({ content: suffix });
      chunk({}, 'stop');
      response.write(
        `data: ${JSON.stringify({
          id: 'markdown-completion',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'chat-model',
          choices: [],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 48,
            total_tokens: 1248,
            prompt_tokens_details: { cached_tokens: 200 },
          },
        })}\n\n`,
      );
      response.end('data: [DONE]\n\n');
    };
    reply().catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No Markdown model listener');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    get requests(): number {
      return requests;
    },
    get closedResponses(): number {
      return closedResponses;
    },
    start,
    finish,
    async close(): Promise<void> {
      start();
      finish();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    },
  };
}
