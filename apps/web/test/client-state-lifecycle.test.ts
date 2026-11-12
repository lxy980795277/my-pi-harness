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
import { useTaskPresentationStore } from '../src/features/tasks/stores/tasks';
import { taskMessageKey, useTaskMessageStore } from '../src/features/tasks/stores/messages';
import { useWorkDraftStore } from '../src/features/work/stores/drafts';
import { useSearchStore } from '../src/features/search/stores/search';
import { SOURCE_SELECTION } from './fixtures/search';

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
    useSearchStore.getState().show();
    useSearchStore.getState().change({ query: '私有检索词', archived: true });
    useSearchStore.getState().select(SOURCE_SELECTION);
    useComposerStore.getState().addSearchQuote('source-session', SOURCE_SELECTION);
    useTimelineStore
      .getState()
      .locate('source-session', { id: 'locate', branchId: 'branch', messageId: 'message' });
    const navigation = useNavigationStore.getState();
    const composer = useComposerStore.getState();
    const generation = composer.newConversationGeneration;
    navigation.selectSession('private-session');
    navigation.selectWorkspace('private-workspace');
    composer.setDraft('private-session', 'private draft');
    composer.beginNewAttempt(generation, {
      model: { providerId: 'provider', modelId: 'model', thinkingLevel: 'off' },
      workspaceId: 'private-workspace',
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
    useTaskPresentationStore.getState().open('private-session', 'private-task');
    useTaskPresentationStore.getState().setFilter('pending');
    const taskKey = taskMessageKey('private-session', 'private-task');
    useTaskMessageStore.getState().setDraft(taskKey, 'private task input');
    useTaskMessageStore.getState().prepare(taskKey, {
      requestId: 'private-task-message',
      text: 'private task input',
      continue: true,
      expectedRunId: 'private-task-run',
    });
    useWorkDraftStore.getState().text('private-question', 'item', 'private answer');
    useWorkDraftStore.getState().setFeedback('private-plan', 'private feedback');

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
      newConversationAttempt: null,
      searchQuotes: {},
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
    expect(useTimelineStore.getState().targets).toEqual({});
    expect(useSearchStore.getState()).toMatchObject({
      open: false,
      selected: null,
      filters: { query: '', archived: false },
    });
    expect(useTaskPresentationStore.getState()).toMatchObject({
      sessionId: null,
      taskId: null,
      filter: 'all',
    });
    expect(useWorkDraftStore.getState()).toMatchObject({ questions: {}, feedback: {} });
    expect(useTaskMessageStore.getState()).toMatchObject({ drafts: {}, attempts: {} });
  });
});
