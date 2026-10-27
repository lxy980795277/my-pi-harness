import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { RemoteMcpManager } from '../../packages/integrations/dist/index.js';

/** Real SDK traffic stays on this isolated issuer; no synthetic token reaches GitHub. */
export async function startPluginMcpUpstream() {
  const sessions = new Map();
  const servers = new Set();
  const http = createServer((request, response) => {
    const task = async () => {
      if (request.headers.authorization !== 'Bearer synthetic-browser-connection-token') {
        response.writeHead(401);
        response.end();
        return;
      }
      const id = request.headers['mcp-session-id'];
      let entry = sessions.get(id);
      if (!entry) {
        if (request.method !== 'POST') {
          response.writeHead(405);
          response.end();
          return;
        }
        const sdk = new Server(
          { name: 'GitHub browser fixture', version: '1' },
          { capabilities: { tools: {} } },
        );
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized(sessionId) {
            sessions.set(sessionId, entry);
          },
        });
        entry = { sdk, transport };
        servers.add(sdk);
        sdk.onclose = () => {
          servers.delete(sdk);
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        sdk.setRequestHandler('tools/list', () =>
          Promise.resolve({
            tools: [
              {
                name: 'get_me',
                description: 'Get the authenticated GitHub user account profile',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                annotations: { readOnlyHint: true },
              },
            ],
          }),
        );
        sdk.setRequestHandler('tools/call', (input) => {
          if (input.params.name !== 'get_me') throw new Error('Unknown fixture tool');
          return Promise.resolve({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  login: 'browser-github-user',
                  name: 'Browser connection account',
                }),
              },
            ],
          });
        });
        await sdk.connect(transport);
      }
      await entry.transport.handleRequest(request, response);
    };
    task().catch(() => response.destroy());
  });
  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing MCP fixture port');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    async close() {
      await Promise.all([...servers].map((sdk) => sdk.close()));
      http.closeAllConnections();
      await new Promise((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

/** Only the host fixture rewrites the fixed official App target, after daemon ownership checks. */
export class BrowserPluginMcpManager extends RemoteMcpManager {
  constructor(origin) {
    super({ fixtureOrigin: origin });
    this.origin = origin;
  }
  acquire(binding, options) {
    if (binding.endpoint === 'https://api.githubcopilot.com/mcp/')
      return super.acquire({ ...binding, endpoint: `${this.origin}/mcp` }, options);
    return super.acquire(binding, options);
  }
}
