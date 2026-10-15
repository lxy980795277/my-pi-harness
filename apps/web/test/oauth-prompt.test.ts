import type { AuthFlow } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { getPromptPresentation, oauthRefetchInterval } from '../src/features/auth/utils/oauth-view';

const prompt = (type: NonNullable<AuthFlow['prompt']>['type']): NonNullable<AuthFlow['prompt']> => {
  return { id: 'challenge', message: 'Provider login', secret: type === 'secret', type };
};

describe('OAuth challenge interaction', () => {
  it('allows an empty normal text response while requiring a secret or authorization code', () => {
    expect(getPromptPresentation(prompt('text')).canSubmitEmpty).toBe(true);
    expect(getPromptPresentation(prompt('secret')).canSubmitEmpty).toBe(false);
    expect(getPromptPresentation(prompt('secret')).inputType).toBe('password');
    expect(getPromptPresentation(prompt('manual_code')).canSubmitEmpty).toBe(false);
    expect(getPromptPresentation(prompt('manual_code')).label).toBe('授权码或回调地址');
  });

  it('keeps option ids and descriptions while presenting browser and device choices', () => {
    const view = getPromptPresentation({
      ...prompt('select'),
      options: [
        { id: 'browser', label: 'Browser', description: 'Local callback' },
        { id: 'device_code', label: 'Device', description: 'Copy the code' },
      ],
    });
    expect(view.options).toEqual([
      { value: 'browser', label: '浏览器登录', description: 'Local callback' },
      { value: 'device_code', label: '设备码登录', description: 'Copy the code' },
    ]);
    expect(view.canSubmitEmpty).toBe(false);
  });

  it('stops polling after completion, failure or cancellation', () => {
    const flow: AuthFlow = {
      id: 'flow',
      providerId: 'provider',
      status: 'pending',
      url: null,
      deviceCode: null,
      prompt: null,
      message: null,
      error: null,
    };
    expect(oauthRefetchInterval(flow)).toBe(1000);
    expect(oauthRefetchInterval({ ...flow, status: 'completed' })).toBe(false);
    expect(oauthRefetchInterval({ ...flow, status: 'failed' })).toBe(false);
    expect(oauthRefetchInterval({ ...flow, status: 'cancelled' })).toBe(false);
  });
});
