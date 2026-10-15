import type { InputRequest } from '@my-pi-harness/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../src/app/stores/workspace';
import { isRejectedInput } from '../src/features/sessions/utils/input-outcome';
import { RequestError } from '../src/services/base-request';

beforeEach(() => {
  useWorkspaceStore.getState().reset();
});

describe('unconfirmed conversation input', () => {
  it('retries the original send after navigation and a running-state change instead of queuing another message', () => {
    const state = useWorkspaceStore.getState();
    const input: InputRequest = { requestId: 'original-request', text: 'run once', mode: 'send' };
    state.prepareInput('session', input);
    state.navigate('runtime');
    state.selectSession('another-session');
    state.selectSession('session');
    const retry = useWorkspaceStore.getState().prepareInput('session', {
      requestId: 'candidate-after-SSE',
      text: 'changed draft',
      mode: 'follow-up',
    });
    expect(retry).toEqual(input);
    state.clearPendingInput('session', 'candidate-after-SSE');
    expect(useWorkspaceStore.getState().pendingInputs.session).toBe(input);
    expect(isRejectedInput(new TypeError('response lost'))).toBe(false);
    expect(isRejectedInput(new RequestError('server error', 500))).toBe(false);
    expect(isRejectedInput(new RequestError('invalid input', 422))).toBe(true);
    state.clearPendingInput('session', retry.requestId);
    expect(useWorkspaceStore.getState().pendingInputs.session).toBeUndefined();
  });

  it('keeps first-send creation and its input associated across pages and isolates a deliberately new conversation', () => {
    const state = useWorkspaceStore.getState();
    const generation = state.newConversationGeneration;
    const intent = {
      model: { providerId: 'provider', modelId: 'model', thinkingLevel: 'off' as const },
      workspaceId: 'workspace',
      approvalMode: 'ask' as const,
      input: { requestId: 'first-send', text: 'first message', mode: 'send' as const },
    };
    state.beginNewAttempt(generation, intent);
    state.markNewAttemptCreated(generation, 'created-session');
    state.navigate('runtime');
    state.navigate('sessions');
    const recovered = state.beginNewAttempt(generation, {
      ...intent,
      input: { ...intent.input, requestId: 'should-not-be-used' },
    });
    expect(recovered).toMatchObject({
      phase: 'created',
      sessionId: 'created-session',
      input: intent.input,
    });
    expect(useWorkspaceStore.getState().pendingInputs['created-session']).toEqual(intent.input);
    state.clearPendingInput('created-session', intent.input.requestId);
    expect(useWorkspaceStore.getState().drafts['created-session']).toBe(intent.input.text);
    state.prepareInput('created-session', intent.input);
    state.confirmInput('created-session', intent.input.requestId);
    expect(useWorkspaceStore.getState().newConversationAttempt).toBeNull();
    expect(useWorkspaceStore.getState().drafts['created-session']).toBeUndefined();
    state.beginNewAttempt(generation, intent);
    state.markNewAttemptCreated(generation, 'created-session');
    state.startNewConversation();
    state.markNewAttemptCreated(generation, 'late-old-response');
    expect(useWorkspaceStore.getState().newConversationGeneration).not.toBe(generation);
    expect(useWorkspaceStore.getState().newConversationAttempt).toBeNull();
    expect(useWorkspaceStore.getState().pendingInputs['late-old-response']).toBeUndefined();
    expect(useWorkspaceStore.getState().pendingInputs['created-session']).toEqual(intent.input);
    const next = useWorkspaceStore.getState();
    next.beginNewAttempt(next.newConversationGeneration, intent);
    next.markNewAttemptUnknown(next.newConversationGeneration);
    next.navigate('runtime');
    next.navigate('sessions');
    expect(useWorkspaceStore.getState().newConversationAttempt?.phase).toBe('unknown');
  });
});
