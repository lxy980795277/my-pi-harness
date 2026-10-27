import { expect, it } from 'vitest';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { McpError, NetworkError } from '@my-pi-harness/integrations';
import { catalogFailure } from '../src/mcp/catalog-failure.js';

it.each([
  [
    new RuntimeError('MCP_CREDENTIAL_REQUIRED', 'private-provider-secret'),
    'MCP_CATALOG_AUTH_REQUIRED',
  ],
  [new McpError('INVALID_CATALOG', 'private-provider-secret'), 'MCP_CATALOG_INVALID'],
  [new NetworkError('DNS_FAILED', 'private-provider-secret'), 'MCP_CATALOG_CONNECTION_FAILED'],
  [new NetworkError('NETWORK_FAILED', 'private-provider-secret'), 'MCP_CATALOG_CONNECTION_FAILED'],
  [new NetworkError('RESPONSE_LIMIT', 'private-provider-secret'), 'MCP_CATALOG_INVALID'],
  [new Error('private-provider-secret'), 'MCP_CATALOG_FAILED'],
  [{ code: 'OAUTH_REQUIRED', message: 'private-provider-secret' }, 'MCP_CATALOG_FAILED'],
  [{ code: 'NETWORK_FAILED', message: 'private-provider-secret' }, 'MCP_CATALOG_FAILED'],
])('publishes only owned discovery categories and fixed messages', (error, code) => {
  const diagnostic = catalogFailure(error);
  expect(diagnostic.code).toBe(code);
  expect(JSON.stringify(diagnostic)).not.toContain('private-provider-secret');
  expect(diagnostic).not.toHaveProperty('cause');
});
