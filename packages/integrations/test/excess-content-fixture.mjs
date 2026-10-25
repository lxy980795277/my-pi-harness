import { appendFile, writeFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const root = process.env['FIXTURE_DIRECTORY'];
await writeFile(`${root}/started`, String(process.pid));
const server = new Server(
  { name: 'content-limit-fixture', version: '1' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'echo',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
    },
  ],
}));
server.setRequestHandler('tools/call', async (request) => {
  await appendFile(`${root}/calls`, JSON.stringify(request.params) + '\n');
  if (process.env['FIXTURE_MODE'] === 'excess-structured')
    return {
      content: Array.from({ length: 128 }, () => ({ type: 'text', text: '' })),
      structuredContent: { answer: 42 },
    };
  return { content: Array.from({ length: 129 }, () => ({ type: 'text', text: '' })) };
});
await server.connect(new StdioServerTransport());
