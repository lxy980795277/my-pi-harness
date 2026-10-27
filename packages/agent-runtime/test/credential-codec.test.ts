import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type OAuthCredential,
} from '@earendil-works/pi-ai';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { createPiCredentialStore, decodeCredential } from '../src/models/credentials.js';
import {
  decodeContextMessage,
  encodeContextMessage,
  encodeToolResult,
} from '../src/context/codec.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('private SDK persistence', () => {
  it('preserves provider response IDs and signatures while refusing unknown codec generations and damaged data', () => {
    const message = fauxAssistantMessage(
      [
        { type: 'thinking', thinking: 'Reasoning', thinkingSignature: 'opaque-thinking-signature' },
        { type: 'text', text: 'Answer', textSignature: 'opaque-text-signature' },
      ],
      { responseId: 'provider-response' },
    );
    const snapshot = encodeContextMessage(message);
    expect(typeof snapshot).toBe('object');
    expect(decodeContextMessage(snapshot)).toEqual(message);
    expect(() => decodeContextMessage({ ...snapshot, codecVersion: 99 })).toThrow(
      'unsupported format',
    );
    expect(() => decodeContextMessage(JSON.stringify(snapshot))).toThrow('unsupported format');
    expect(() => decodeContextMessage({ codecVersion: 1, message: {} })).toThrow(
      'unsupported format',
    );
    message.content.length = 0;
    message.responseId = 'mutated-response';
    expect(decodeContextMessage(snapshot)).toMatchObject({
      responseId: 'provider-response',
      content: [
        { thinkingSignature: 'opaque-thinking-signature' },
        { textSignature: 'opaque-text-signature' },
      ],
    });
    expect(() =>
      decodeCredential('{"version":1,"credential":{"type":"oauth","access":"only-access"}}'),
    ).toThrow('unsupported format');
  });

  it('snapshots canonical tool results as objects independently from later tool mutations', () => {
    const content = { type: 'text' as const, text: 'Observed result' };
    const result = {
      toolResultVersion: 1 as const,
      providerCallId: 'call',
      toolName: 'read_file',
      content: [content],
      isError: false,
      at: 1,
      origin: 'tool' as const,
      outcome: 'completed' as const,
    };
    const snapshot = encodeToolResult(result);
    content.text = 'Later mutation';
    expect(snapshot).toMatchObject({ content: [{ text: 'Observed result' }] });
    expect(decodeContextMessage(snapshot)).toEqual({
      role: 'toolResult',
      toolCallId: 'call',
      toolName: 'read_file',
      content: [{ type: 'text', text: 'Observed result' }],
      isError: false,
      timestamp: 1,
      details: { harnessOutcome: 'completed', origin: 'tool' },
    });
    expect(() => decodeContextMessage(JSON.stringify(snapshot))).toThrow('unsupported format');
  });

  it('continues an already-started Pi OAuth refresh after cancellation and drains its rotated token before close', async () => {
    const secrets = createMemoryCredentialStore();
    const credentials = createPiCredentialStore(
      secrets,
      () => 'fixture-ref',
      () => ['fixture-account'],
    );
    const expired: OAuthCredential = {
      type: 'oauth',
      access: 'old-access',
      refresh: 'old-refresh',
      expires: Date.now() - 1,
    };
    await credentials.modify('fixture-account', () => Promise.resolve(expired));
    const refreshStarted = gate();
    const finishRefresh = gate();
    const faux = fauxProvider();
    const models = createModels({ credentials });
    models.setProvider({
      ...faux.provider,
      id: 'fixture-account',
      auth: {
        oauth: {
          name: 'Fixture OAuth',
          login: () => Promise.resolve(expired),
          async refresh() {
            refreshStarted.release();
            await finishRefresh.promise;
            return {
              type: 'oauth',
              access: 'rotated-access',
              refresh: 'rotated-refresh',
              expires: Date.now() + 3600_000,
            };
          },
          toAuth: (credential) => Promise.resolve({ apiKey: credential.access }),
        },
      },
    });
    const controller = new AbortController();
    const request = models.getAuth('fixture-account', { signal: controller.signal });
    try {
      await refreshStarted.promise;
      controller.abort();
      await expect(request).rejects.toBeDefined();
      let idle = false;
      const closing = credentials.waitForIdle().then(() => {
        idle = true;
      });
      await Promise.resolve();
      expect(idle).toBe(false);
      finishRefresh.release();
      await closing;
      expect(await credentials.read('fixture-account')).toMatchObject({
        access: 'rotated-access',
        refresh: 'rotated-refresh',
      });
      expect(await credentials.list()).toEqual([{ providerId: 'fixture-account', type: 'oauth' }]);
      await credentials.modify('fixture-account', () => Promise.resolve(undefined));
      expect(await credentials.read('fixture-account')).toMatchObject({
        refresh: 'rotated-refresh',
      });
    } finally {
      finishRefresh.release();
      await request.catch(() => undefined);
      await credentials.waitForIdle();
      models.clearProviders();
    }
  });
});
