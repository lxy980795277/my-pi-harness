import { createServer } from 'node:http';

interface FailureModel {
  origin: string;
  failPartial: () => void;
  close: () => Promise<void>;
}

/** Real Pi receives an authentication rejection, a controlled broken stream and a successful reply. */
export const startFailureModel = async (): Promise<FailureModel> => {
  let requests = 0;
  let failPartial = (): void => {
    throw new Error('Partial response has not started');
  };
  const server = createServer((request, response) => {
    const reply = async (): Promise<void> => {
      for await (const _chunk of request) {
        // Drain the provider input before producing the selected deterministic outcome.
      }
      requests += 1;
      if (requests === 1) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            error: { message: 'synthetic invalid_api_key', type: 'invalid_request_error' },
          }),
        );
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const chunk = (content: string, finishReason: string | null = null): void => {
        response.write(
          `data: ${JSON.stringify({ id: 'failure-fixture', object: 'chat.completion.chunk', created: 1, model: 'chat-model', choices: [{ index: 0, delta: { content }, finish_reason: finishReason }] })}\n\n`,
        );
      };
      if (requests === 2) {
        chunk('已经生成的部分正文。');
        failPartial = (): void => {
          response.destroy();
        };
        return;
      }
      chunk('后续请求成功，旧请求错误仍保留。');
      chunk('', 'stop');
      response.end('data: [DONE]\n\n');
    };
    reply().catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing failure model listener');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    failPartial: (): void => {
      failPartial();
    },
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
};
