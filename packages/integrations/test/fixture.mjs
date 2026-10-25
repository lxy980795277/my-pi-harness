import { appendFile, writeFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const root = process.env['FIXTURE_DIRECTORY'];
const mode = process.env['FIXTURE_MODE'] ?? 'normal';
await writeFile(`${root}/started`, String(process.pid));
const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
let pages = 0;
const schema = {
  type: 'object',
  properties: { value: { type: 'string' } },
  required: ['value'],
  additionalProperties: false,
};
server.setRequestHandler('tools/list', async () => {
  if (mode === 'bad-schema')
    return {
      tools: [
        {
          name: 'echo',
          inputSchema: {
            type: 'object',
            properties: { value: { $ref: 'https://example.com/schema' } },
          },
        },
      ],
    };
  if (mode === 'secret-catalog')
    return {
      tools: [{ name: 'echo', description: process.env['FAKE_SECRET'], inputSchema: schema }],
    };
  if (mode === 'repeated-cursor')
    return { tools: [{ name: `echo-${pages++}`, inputSchema: schema }], nextCursor: 'same' };
  if (mode === 'duplicate')
    return {
      tools: [
        { name: 'echo', inputSchema: schema },
        { name: 'echo', inputSchema: schema },
      ],
    };
  return {
    tools: [
      {
        name: 'echo',
        description: mode === 'changed' ? 'changed' : 'Echo a fixture value',
        inputSchema: schema,
      },
      {
        name: 'disconnect',
        description: 'Exit after receiving one fixture call',
        inputSchema: schema,
      },
    ],
  };
});
server.setRequestHandler('tools/call', async (request) => {
  await appendFile(`${root}/calls`, JSON.stringify(request.params) + '\n');
  if (request.params.name === 'disconnect') process.exit(1);
  if (mode === 'hang') return await new Promise(() => {});
  if (mode === 'pollute') {
    process.stdout.write('not json\n');
    return await new Promise(() => {});
  }
  if (mode === 'bad-utf8') {
    process.stdout.write(Buffer.from([255, 10]));
    return await new Promise(() => {});
  }
  if (mode === 'partial-eof') {
    process.stdout.write('{"unfinished":');
    process.exitCode = 0;
    process.stdin.destroy();
    return await new Promise(() => {});
  }
  if (mode === 'secret-result') {
    process.stderr.write(process.env['FAKE_SECRET'].slice(0, 5));
    process.stderr.write(process.env['FAKE_SECRET'].slice(5));
    return { content: [{ type: 'text', text: process.env['FAKE_SECRET'] }] };
  }
  if (mode === 'structured')
    return { content: [], structuredContent: { value: request.params.arguments.value } };
  return {
    content: [{ type: 'text', text: request.params.arguments.value }],
    isError: mode === 'error',
  };
});
await server.connect(new StdioServerTransport());
