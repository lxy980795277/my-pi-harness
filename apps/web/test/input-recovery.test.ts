import type { InputRequest } from '@my-pi-harness/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNavigationStore } from '../src/app/stores/navigation';
import { useComposerStore } from '../src/features/sessions/stores/composer';
import { isRejectedInput } from '../src/features/sessions/utils/input-outcome';
import { RequestError } from '../src/services/base-request';

beforeEach(() => {
  useComposerStore.getState().reset();
  useNavigationStore.getState().reset();
});

describe('unconfirmed conversation input', () => {
  it('retries the original send after navigation and a running-state change instead of queuing another message', () => {
    const state = useComposerStore.getState();
    const input: InputRequest = {
      requestId: 'original-request',
      text: 'run once',
      mode: 'send',
      attachmentIds: ['frozen-attachment'],
    };
    state.prepareInput('session', input);
    useNavigationStore.getState().navigate('runtime');
    useNavigationStore.getState().selectSession('another-session');
    useNavigationStore.getState().selectSession('session');
    const retry = useComposerStore.getState().prepareInput('session', {
      requestId: 'candidate-after-SSE',
      text: 'changed draft',
      mode: 'follow-up',
    });
    expect(retry).toEqual(input);
    state.clearPendingInput('session', 'candidate-after-SSE');
    expect(useComposerStore.getState().pendingInputs.session).toBe(input);
    expect(isRejectedInput(new TypeError('response lost'))).toBe(false);
    expect(isRejectedInput(new RequestError('server error', 500))).toBe(false);
    expect(isRejectedInput(new RequestError('invalid input', 422))).toBe(true);
    state.clearPendingInput('session', retry.requestId);
    expect(useComposerStore.getState().pendingInputs.session).toBeUndefined();
  });

  it('keeps first-send creation and its input associated across pages and isolates a deliberately new conversation', () => {
    const state = useComposerStore.getState();
    const generation = state.newConversationGeneration;
    const intent = {
      model: { providerId: 'provider', modelId: 'model', thinkingLevel: 'off' as const },
      workspaceId: 'workspace',
      approvalMode: 'ask' as const,
      input: {
        requestId: 'first-send',
        text: 'first message',
        mode: 'send' as const,
        attachmentIds: ['first-attachment'],
      },
    };
    state.beginNewAttempt(generation, intent);
    state.markNewAttemptCreated(generation, 'created-session');
    useNavigationStore.getState().navigate('runtime');
    useNavigationStore.getState().navigate('sessions');
    const recovered = state.beginNewAttempt(generation, {
      ...intent,
      input: { ...intent.input, requestId: 'should-not-be-used' },
    });
    expect(recovered).toMatchObject({
      phase: 'created',
      sessionId: 'created-session',
      input: intent.input,
    });
    expect(useComposerStore.getState().pendingInputs['created-session']).toEqual(intent.input);
    state.clearPendingInput('created-session', intent.input.requestId);
    expect(useComposerStore.getState().drafts['created-session']).toBe(intent.input.text);
    state.prepareInput('created-session', intent.input);
    state.confirmInput('created-session', intent.input.requestId);
    expect(useComposerStore.getState().newConversationAttempt).toBeNull();
    expect(useComposerStore.getState().drafts['created-session']).toBeUndefined();
    state.beginNewAttempt(generation, intent);
    state.markNewAttemptCreated(generation, 'created-session');
    state.startNewConversation();
    state.markNewAttemptCreated(generation, 'late-old-response');
    expect(useComposerStore.getState().newConversationGeneration).not.toBe(generation);
    expect(useComposerStore.getState().newConversationAttempt).toBeNull();
    expect(useComposerStore.getState().pendingInputs['late-old-response']).toBeUndefined();
    expect(useComposerStore.getState().pendingInputs['created-session']).toEqual(intent.input);
    const next = useComposerStore.getState();
    next.beginNewAttempt(next.newConversationGeneration, intent);
    next.markNewAttemptUnknown(next.newConversationGeneration);
    useNavigationStore.getState().navigate('runtime');
    useNavigationStore.getState().navigate('sessions');
    expect(useComposerStore.getState().newConversationAttempt?.phase).toBe('unknown');
  });
});
