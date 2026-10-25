import { createServer, type ServerResponse } from 'node:http';
import {
  Server,
  parseJSONRPCMessage,
  serializeMessage,
  type Transport,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

/** Test-only legacy HTTP/SSE framing delegates every protocol operation to the official SDK Server. */
class SseFixtureTransport implements Transport {
  public onclose: (() => void) | undefined;
  public onerror: ((error: Error) => void) | undefined;
  public onmessage: ((message: JSONRPCMessage) => void) | undefined;
  public constructor(private readonly response: ServerResponse) {}
  public start(): Promise<void> {
    this.response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    this.response.write('event: endpoint\ndata: /messages\n\n');
    return Promise.resolve();
  }
  public send(message: JSONRPCMessage): Promise<void> {
    this.response.write(`event: message\ndata: ${serializeMessage(message).trim()}\n\n`);
    return Promise.resolve();
  }
  public close(): Promise<void> {
    this.response.end();
    this.onclose?.();
    return Promise.resolve();
  }
}
export interface RemoteFixture {
  origin: string;
  endpoint: string;
  calls(): number;
  requests(): number;
  failures: unknown[];
  close(): Promise<void>;
}
export async function remoteFixture(
  transport: 'streamable-http' | 'sse',
  mode: 'normal' | 'disconnect' | 'redirect' | 'cross-origin' = 'normal',
): Promise<RemoteFixture> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Low-level handlers exercise protocol disconnects and legacy SSE framing through the official Server.
  const sdk = new Server(
    { name: 'remote-fixture', version: '1' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  let calls = 0;
  let requests = 0;
  const failures: unknown[] = [];
  const http = createServer((request, response) => {
    requests += 1;
    const task = (async () => {
      if (mode === 'redirect') {
        response.writeHead(302, { location: 'https://example.org/elsewhere' });
        response.end();
        return;
      }
      if (transport === 'streamable-http') {
        await streamable.handleRequest(request, response);
        return;
      }
      if (request.method === 'GET') {
        if (mode === 'cross-origin') {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write('event: endpoint\ndata: https://example.org/messages\n\n');
          return;
        }
        sse = new SseFixtureTransport(response);
        await sdk.connect(sse);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const message = parseJSONRPCMessage(value);
      sse?.onmessage?.(message);
      response.writeHead(202);
      response.end();
    })();
    task.catch((error) => {
      failures.push(error);
      response.destroy();
    });
  });
  const streamable = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
  });
  let sse: SseFixtureTransport | undefined;
  sdk.setRequestHandler('tools/list', () =>
    Promise.resolve({
      tools: [
        {
          name: 'echo',
          description: 'Echo remote value',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      ],
    }),
  );
  sdk.setRequestHandler('resources/list', () =>
    Promise.resolve({
      resources: [
        { uri: 'fixture://resource', name: 'Fixture resource', description: 'Metadata only' },
      ],
    }),
  );
  sdk.setRequestHandler('prompts/list', () =>
    Promise.resolve({
      prompts: [
        {
          name: 'fixture-prompt',
          description: 'Metadata only',
          arguments: [{ name: 'topic', required: true }],
        },
      ],
    }),
  );
  sdk.setRequestHandler('tools/call', (request) => {
    calls += 1;
    if (mode === 'disconnect') {
      http.closeAllConnections();
      throw new Error('Fixture disconnect');
    }
    const parameters = request.params.arguments;
    if (!Value.Check(Type.Object({ value: Type.String() }), parameters))
      throw new Error('Invalid fixture arguments');
    return Promise.resolve({ content: [{ type: 'text' as const, text: parameters.value }] });
  });
  if (transport === 'streamable-http') await sdk.connect(streamable);
  await new Promise<void>((accept, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', () => {
      http.off('error', reject);
      accept();
    });
  });
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    endpoint: `${origin}/${transport === 'sse' ? 'sse' : 'mcp'}`,
    calls: () => calls,
    requests: () => requests,
    failures,
    close: async () => {
      await sdk.close();
      await streamable.close();
      await sse?.close();
      http.closeAllConnections();
      await new Promise<void>((accept, reject) => {
        http.close((error) => {
          if (error !== undefined) reject(error);
          else accept();
        });
      });
    },
  };
}
