import type { Attachment } from '@my-pi-harness/protocol';
import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useResetClientState } from '../src/app/hooks/use-reset-client-state';
import { useStartNewConversation } from '../src/app/hooks/use-start-new-conversation';
import { useNavigationStore } from '../src/app/stores/navigation';
import { useAttachmentDrafts } from '../src/features/attachments/stores/attachment-drafts';
import { useComposerStore } from '../src/features/sessions/stores/composer';
import { useTimelineStore } from '../src/features/sessions/stores/timeline';
import { useSettingsStore } from '../src/features/settings/stores/settings';

const DRAFT_ATTACHMENT: Attachment = {
  id: 'draft-attachment',
  name: 'draft.txt',
  mediaType: 'text/plain',
  kind: 'text',
  byteLength: 5,
  preview: 'draft',
  sourcePath: null,
  createdAt: 0,
};

const readClientAction = (useAction: () => () => void): (() => void) => {
  let action: (() => void) | undefined;
  const Probe: FC = () => {
    action = useAction();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  if (action === undefined) {
    throw new Error('Client action was not rendered.');
  }
  return action;
};

beforeEach(() => {
  readClientAction(useResetClientState)();
});

describe('private client state lifecycle', () => {
  it('starts a new conversation without discarding model, approval, workspace or other session drafts', () => {
    const navigation = useNavigationStore.getState();
    const composer = useComposerStore.getState();
    const model = { providerId: 'provider', modelId: 'model', thinkingLevel: 'off' as const };
    const generation = composer.newConversationGeneration;
    navigation.selectWorkspace('workspace');
    navigation.selectSession('existing-session');
    composer.setNewConversationModel(model);
    composer.setNewConversationApproval('full-access');
    composer.setNewConversationWorkMode('plan');
    composer.setNewConversationDraft('discard this new draft');
    composer.setDraft('existing-session', 'keep the existing draft');
    useAttachmentDrafts.getState().add('existing-session', DRAFT_ATTACHMENT);
    useAttachmentDrafts.getState().setBusy('existing-session', true);

    readClientAction(useStartNewConversation)();

    expect(useNavigationStore.getState()).toMatchObject({
      page: 'sessions',
      activeSessionId: null,
      activeWorkspaceId: 'workspace',
    });
    expect(useComposerStore.getState()).toMatchObject({
      newConversationDraft: '',
      newConversationModel: model,
      newConversationApproval: 'full-access',
      newConversationWorkMode: 'execute',
      drafts: { 'existing-session': 'keep the existing draft' },
    });
    expect(useComposerStore.getState().newConversationGeneration).not.toBe(generation);
    navigation.selectSession('other-session');
    navigation.selectSession('existing-session');
    expect(useComposerStore.getState().drafts['existing-session']).toBe('keep the existing draft');
    expect(useAttachmentDrafts.getState().drafts['existing-session']).toEqual([DRAFT_ATTACHMENT]);
    expect(useAttachmentDrafts.getState().busy['existing-session']).toBe(true);
  });

  it('closing settings clears its nested UI without clearing conversation drafts', () => {
    const settings = useSettingsStore.getState();
    useComposerStore.getState().setDraft('session', 'unsent input');
    settings.openSettings('general');
    settings.openProvider('provider');
    settings.setProviderAuthFlow('flow');
    settings.setProviderAuthStarting(true);
    settings.openModels('provider');

    settings.closeSettings();

    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: false,
      settingsSection: 'general',
      providerDialogId: null,
      providerAuthFlowId: null,
      providerAuthStarting: false,
      modelsDialogId: null,
    });
    expect(useComposerStore.getState().drafts.session).toBe('unsent input');
  });

  it('authorization cleanup clears every private domain and invalidates an older creation attempt', () => {
    const navigation = useNavigationStore.getState();
    const composer = useComposerStore.getState();
    const generation = composer.newConversationGeneration;
    navigation.selectSession('private-session');
    navigation.selectWorkspace('private-workspace');
    composer.setDraft('private-session', 'private draft');
    composer.beginNewAttempt(generation, {
      model: { providerId: 'provider', modelId: 'model', thinkingLevel: 'off' },
      workspaceId: 'private-workspace',
      workMode: 'plan',
      approvalMode: 'ask',
      input: { requestId: 'private-request', text: 'private input', mode: 'send' },
    });
    useSettingsStore.getState().openSettings('general');
    useSettingsStore.getState().openProvider('private-provider');
    useSettingsStore.getState().setProviderAuthFlow('private-flow');
    useAttachmentDrafts.getState().add('private-session', DRAFT_ATTACHMENT);
    useAttachmentDrafts.getState().setBusy('private-session', true);
    useTimelineStore.getState().setToolExpanded('private-session', 'private-tool', true);
    useTimelineStore.getState().toggleProcess('private-session', 'private-input');

    readClientAction(useResetClientState)();
    composer.markNewAttemptCreated(generation, 'late-private-session');

    expect(useNavigationStore.getState()).toMatchObject({
      page: 'sessions',
      activeSessionId: null,
      activeWorkspaceId: null,
    });
    expect(useComposerStore.getState()).toMatchObject({
      drafts: {},
      pendingInputs: {},
      newConversationDraft: '',
      newConversationModel: null,
      newConversationApproval: 'full-access',
      newConversationWorkMode: 'execute',
      newConversationAttempt: null,
    });
    expect(useComposerStore.getState().newConversationGeneration).not.toBe(generation);
    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: false,
      settingsSection: 'models',
      providerDialogId: null,
      providerAuthFlowId: null,
      providerAuthStarting: false,
      modelsDialogId: null,
    });
    expect(useAttachmentDrafts.getState()).toMatchObject({ drafts: {}, busy: {} });
    expect(useTimelineStore.getState().expandedTools).toEqual({});
    expect(useTimelineStore.getState().expandedProcesses).toEqual({});
  });
});
