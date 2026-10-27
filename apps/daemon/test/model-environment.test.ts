import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { clearAmbientModelEnvironment } from '../src/application/model-environment.js';

const execute = promisify(execFile);
const CapturedRequests = Type.Array(
  Type.Object({
    headers: Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())])),
  }),
);

describe('daemon SDK environment ownership', () => {
  it('removes only verified SDK overrides, including Windows case variants', () => {
    const environment = {
      OPENAI_API_KEY: 'fake',
      OpenAI_Custom_Headers: 'fake',
      anthropic_log: 'debug',
      OPENAI_UNRELATED_SETTING: 'retained',
      PATH: 'retained',
      MY_PI_HARNESS_PORT: '0',
    };
    clearAmbientModelEnvironment(environment);
    expect(environment).toEqual({
      OPENAI_UNRELATED_SETTING: 'retained',
      PATH: 'retained',
      MY_PI_HARNESS_PORT: '0',
    });
  });

  it('keeps all three real SDK HTTP requests free of ambient keys, tenant IDs, arbitrary headers and SDK console logs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-sdk-environment-'));
    try {
      const { stdout, stderr } = await execute(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('./fixtures/model-environment.ts', import.meta.url)),
          directory,
        ],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          timeout: 15_000,
          maxBuffer: 64 * 1024,
          env: {
            ...process.env,
            OPENAI_API_KEY: 'fixture-ambient-key',
            OPENAI_ADMIN_KEY: 'fixture-ambient-admin',
            OPENAI_ORG_ID: 'fixture-ambient-org',
            OPENAI_PROJECT_ID: 'fixture-ambient-project',
            OPENAI_CUSTOM_HEADERS:
              'X-Ambient-OpenAI: fixture-ambient-openai-header\nAuthorization: Bearer fixture-ambient-header-key',
            OPENAI_WEBHOOK_SECRET: 'fixture-ambient-webhook',
            OPENAI_LOG: 'debug',
            OPENAI_BASE_URL: 'https://fixture-ambient.invalid/v1',
            ANTHROPIC_API_KEY: 'fixture-ambient-anthropic-key',
            ANTHROPIC_AUTH_TOKEN: 'fixture-ambient-auth-token',
            ANTHROPIC_CUSTOM_HEADERS:
              'X-Ambient-Anthropic: fixture-ambient-anthropic-header\nX-Api-Key: fixture-ambient-header-api-key',
            ANTHROPIC_WEBHOOK_SIGNING_KEY: 'fixture-ambient-signing-key',
            ANTHROPIC_LOG: 'debug',
            ANTHROPIC_BASE_URL: 'https://fixture-ambient.invalid',
          },
        },
      );
      const requests: unknown = JSON.parse(stdout);
      if (!Value.Check(CapturedRequests, requests)) throw new Error('Invalid SDK fixture output');
      expect(requests).toHaveLength(3);
      for (const { headers } of requests) {
        expect(headers['x-explicit-client']).toBe('fixture-explicit-client');
        for (const name of [
          'authorization',
          'x-api-key',
          'api-key',
          'cf-aig-authorization',
          'openai-organization',
          'openai-project',
          'x-ambient-openai',
          'x-ambient-anthropic',
        ])
          expect(headers[name]).toBeUndefined();
      }
      expect(stdout).not.toContain('fixture-ambient');
      expect(stderr).toBe('');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
