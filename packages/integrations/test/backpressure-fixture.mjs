import { writeFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const root = process.env['FIXTURE_DIRECTORY'];
await writeFile(`${root}/started`, String(process.pid));
const server = new Server(
  { name: 'backpressure-fixture', version: '1' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler('tools/list', async () => {
  // The discovery response still travels through stdout; subsequent stdin bytes remain unread.
  process.stdin.pause();
  await writeFile(`${root}/paused`, 'ready');
  return {
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
  };
});
server.setRequestHandler('tools/call', async () => {
  throw new Error('The paused transport must not consume a call');
});
await server.connect(new StdioServerTransport());

setInterval(() => {}, 1000);
