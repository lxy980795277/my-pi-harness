import { createServer } from 'node:http';
import {
  createProvider,
  envApiKeyAuth,
  fauxAssistantMessage,
  normalizeContext,
  type AssistantMessage,
  type Message,
  type Model,
  type Provider,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { decodeContextMessage, encodeContextMessage } from '../src/context/codec.js';

interface WireFixture {
  model: Model<'openai-completions'>;
  provider: Provider<'openai-completions'>;
  requests: string[];
  close(): Promise<void>;
}

const requestSchema = Type.Object({
  messages: Type.Array(
    Type.Object({
      role: Type.String(),
      content: Type.Optional(Type.Unknown()),
      tool_call_id: Type.Optional(Type.String()),
    }),
  ),
});

async function wireFixture(
  deltas: readonly Record<string, unknown>[],
  finishReason: 'stop' | 'tool_calls' = 'stop',
): Promise<WireFixture> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [index, delta] of [...deltas, {}].entries()) {
        response.write(
          `data: ${JSON.stringify({
            id: 'wire-response',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'wire-model',
            choices: [
              { index: 0, delta, finish_reason: index === deltas.length ? finishReason : null },
            ],
          })}\n\n`,
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a dynamic TCP port');
    const model: Model<'openai-completions'> = {
      id: 'wire-model',
      name: 'Wire model',
      provider: 'wire-provider',
      api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      reasoning: true,
      input: ['text'],
      contextWindow: 8192,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    return {
      model,
      provider: createProvider({
        id: model.provider,
        name: 'Wire provider',
        models: [model],
        auth: { apiKey: envApiKeyAuth('Fixture key', []) },
        api: openAICompletionsApi(),
      }),
      requests,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    };
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
}

function complete(fixture: WireFixture, messages: Message[]): Promise<AssistantMessage> {
  return fixture.provider
    .streamSimple(fixture.model, normalizeContext({ messages }), {
      apiKey: 'wire-test-key',
      signal: AbortSignal.timeout(5000),
    })
    .result();
}

describe('Pi adapter upgrade behavior over HTTP/SSE', () => {
  it('emits reasoning before visible content when both arrive in one provider chunk', async () => {
    const fixture = await wireFixture([
      { role: 'assistant', reasoning_content: 'Check the evidence.', content: 'Observed answer.' },
    ]);
    try {
      const stream = fixture.provider.streamSimple(
        fixture.model,
        normalizeContext({ messages: [{ role: 'user', content: 'Explain.', timestamp: 1 }] }),
        { apiKey: 'wire-test-key', signal: AbortSignal.timeout(5000) },
      );
      const updates: string[] = [];
      for await (const event of stream) {
        if (event.type === 'thinking_delta' || event.type === 'text_delta')
          updates.push(event.type);
      }
      expect(updates).toEqual(['thinking_delta', 'text_delta']);
      expect((await stream.result()).content).toEqual([
        expect.objectContaining({ type: 'thinking', thinking: 'Check the evidence.' }),
        expect.objectContaining({ type: 'text', text: 'Observed answer.' }),
      ]);
    } finally {
      await fixture.close();
    }
  });

  it('retains the complete malformed argument text instead of accepting its streamed prefix', async () => {
    const first = '{"path":"result.txt",';
    const last = '"content":"must not execute"';
    const fixture = await wireFixture(
      [
        {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'malformed-call',
              type: 'function',
              function: { name: 'write_file', arguments: first },
            },
          ],
        },
        { tool_calls: [{ index: 0, function: { arguments: last } }] },
      ],
      'tool_calls',
    );
    try {
      const message = await complete(fixture, [
        { role: 'user', content: 'Create a result.', timestamp: 1 },
      ]);
      expect(message.stopReason).toBe('toolUse');
      expect(message.content).toHaveLength(1);
      const call = message.content[0];
      if (call?.type !== 'toolCall') throw new Error('Expected the malformed tool call');
      expect(call).toMatchObject({ id: 'malformed-call', name: 'write_file', arguments: {} });
      expect(call.argumentsError).toContain(first + last);
      expect(decodeContextMessage(encodeContextMessage(message))).toEqual(message);
    } finally {
      await fixture.close();
    }
  });

  it('omits another model reasoning from the request while preserving its durable message', async () => {
    const original: AssistantMessage = {
      ...fauxAssistantMessage([
        { type: 'thinking', thinking: 'Private former reasoning.', thinkingSignature: 'signature' },
        { type: 'text', text: 'Prior visible answer.' },
      ]),
      api: 'openai-completions',
      provider: 'former-provider',
      model: 'former-model',
    };
    const encoded = encodeContextMessage(original);
    const before = JSON.stringify(encoded);
    const fixture = await wireFixture([{ role: 'assistant', content: 'Continued.' }]);
    try {
      expect(
        (
          await complete(fixture, [
            { role: 'user', content: 'First request.', timestamp: 1 },
            decodeContextMessage(encoded),
            { role: 'user', content: 'Continue with a different model.', timestamp: 2 },
          ])
        ).stopReason,
      ).toBe('stop');
      expect(fixture.requests).toHaveLength(1);
      expect(fixture.requests[0]).toContain('Prior visible answer.');
      expect(fixture.requests[0]).not.toContain('Private former reasoning.');
      expect(fixture.requests[0]).not.toContain('signature');
      expect(JSON.stringify(encoded)).toBe(before);
      expect(decodeContextMessage(encoded)).toEqual(original);
    } finally {
      await fixture.close();
    }
  });

  it('sends a nonblank tool-result placeholder without modifying the retained whitespace result', async () => {
    const call: AssistantMessage = {
      ...fauxAssistantMessage(
        [{ type: 'toolCall', id: 'empty-call', name: 'run_command', arguments: {} }],
        { stopReason: 'toolUse' },
      ),
      api: 'openai-completions',
      provider: 'wire-provider',
      model: 'wire-model',
    };
    const result: Message = {
      role: 'toolResult',
      toolCallId: 'empty-call',
      toolName: 'run_command',
      content: [{ type: 'text', text: '\r\n\t ' }],
      isError: false,
      timestamp: 2,
    };
    const fixture = await wireFixture([{ role: 'assistant', content: 'Command finished.' }]);
    try {
      expect(
        (
          await complete(fixture, [
            { role: 'user', content: 'Run the command.', timestamp: 1 },
            call,
            result,
          ])
        ).stopReason,
      ).toBe('stop');
      const request: unknown = JSON.parse(fixture.requests[0] ?? 'null');
      if (!Value.Check(requestSchema, request)) throw new Error('Expected a messages request');
      const tool = request.messages.find((message) => message.role === 'tool');
      expect(tool?.tool_call_id).toBe('empty-call');
      expect(tool?.content).toEqual(expect.stringMatching(/\S/));
      expect(result.content).toEqual([{ type: 'text', text: '\r\n\t ' }]);
    } finally {
      await fixture.close();
    }
  });
});
