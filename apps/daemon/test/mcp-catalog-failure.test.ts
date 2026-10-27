import { expect, it } from 'vitest';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { McpError } from '@my-pi-harness/integrations';
import { catalogFailure } from '../src/features/mcp/catalog-failure.js';

it.each([
  [
    new RuntimeError('MCP_CREDENTIAL_REQUIRED', 'private-provider-secret'),
    'MCP_CATALOG_AUTH_REQUIRED',
  ],
  [new McpError('INVALID_CATALOG', 'private-provider-secret'), 'MCP_CATALOG_INVALID'],
  [new Error('private-provider-secret'), 'MCP_CATALOG_FAILED'],
  [{ code: 'OAUTH_REQUIRED', message: 'private-provider-secret' }, 'MCP_CATALOG_FAILED'],
])('publishes only owned discovery categories and fixed messages', (error, code) => {
  const diagnostic = catalogFailure(error);
  expect(diagnostic.code).toBe(code);
  expect(JSON.stringify(diagnostic)).not.toContain('private-provider-secret');
  expect(diagnostic).not.toHaveProperty('cause');
});
