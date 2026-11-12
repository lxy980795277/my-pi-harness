import { beforeEach, describe, expect, it } from 'vitest';
import { useComposerStore } from '../src/features/sessions/stores/composer';
import {
  quotedInputText,
  remainingSearchQuotes,
  searchQuoteFields,
} from '../src/features/sessions/utils/search-quotes';
import { sourceSelectionKey } from '../src/features/search/utils/search';
import { SOURCE_SELECTION } from './fixtures/search';

beforeEach(() => {
  useComposerStore.getState().reset();
});

describe('typed search references in composer drafts', () => {
  it('adding a source never sends or replaces a draft, deduplicates exact ranges and freezes uncertain retries', () => {
    const store = useComposerStore.getState();
    store.setDraft('session', '保留原草稿');
    store.addSearchQuote('session', SOURCE_SELECTION);
    store.addSearchQuote('session', SOURCE_SELECTION);
    expect(useComposerStore.getState().drafts.session).toBe('保留原草稿');
    expect(useComposerStore.getState().searchQuotes.session).toEqual([SOURCE_SELECTION]);
    expect(useComposerStore.getState().pendingInputs.session).toBeUndefined();
    const input = store.prepareInput('session', {
      requestId: 'original',
      mode: 'follow-up',
      text: '保留原草稿',
      searchQuotes: [SOURCE_SELECTION],
    });
    expect(() => store.addSearchQuote('session', { ...SOURCE_SELECTION, start: 1 })).toThrow(
      '提交结果尚未确认',
    );
    expect(store.prepareInput('session', { requestId: 'new', mode: 'send', text: 'changed' })).toBe(
      input,
    );
    store.confirmInput('session', 'wrong-request');
    expect(useComposerStore.getState().searchQuotes.session).toEqual([SOURCE_SELECTION]);
    store.confirmInput('session', input.requestId);
    expect(useComposerStore.getState().searchQuotes.session).toBeUndefined();
    expect(useComposerStore.getState().drafts.session).toBeUndefined();
  });

  it('bounds explicit references and removes only the references acknowledged by the submitted input', () => {
    const store = useComposerStore.getState();
    for (let index = 0; index < 4; index += 1)
      store.addSearchQuote('session', { ...SOURCE_SELECTION, start: index });
    expect(() => store.addSearchQuote('session', { ...SOURCE_SELECTION, start: 4 })).toThrow(
      '最多引用 4',
    );
    expect(() =>
      store.addSearchQuote('different', { ...SOURCE_SELECTION, start: 0, end: 8001 }),
    ).toThrow('8,000');
    expect(
      remainingSearchQuotes(
        [SOURCE_SELECTION, { ...SOURCE_SELECTION, start: 1 }],
        [SOURCE_SELECTION],
      ),
    ).toEqual([{ ...SOURCE_SELECTION, start: 1 }]);
    store.removeSearchQuote('session', sourceSelectionKey(SOURCE_SELECTION));
    expect(useComposerStore.getState().searchQuotes.session).toHaveLength(3);
    expect(quotedInputText('', [SOURCE_SELECTION])).toBe('请结合所选引用回答。');
    expect(searchQuoteFields([])).toEqual({});
  });

  it('carries selected new-conversation references through creation and clears them only on input acknowledgement', () => {
    const store = useComposerStore.getState();
    const generation = store.newConversationGeneration;
    store.addSearchQuote(`new:${generation}`, SOURCE_SELECTION);
    const input = {
      requestId: 'new-input',
      mode: 'send' as const,
      text: '请结合所选引用回答。',
      searchQuotes: [SOURCE_SELECTION],
    };
    store.beginNewAttempt(generation, {
      input,
      model: { providerId: 'provider', modelId: 'model', thinkingLevel: 'off' },
      workspaceId: null,
      approvalMode: 'full-access',
    });
    store.markNewAttemptCreated(generation, 'created-session');
    expect(useComposerStore.getState().pendingInputs['created-session']?.searchQuotes).toEqual([
      SOURCE_SELECTION,
    ]);
    expect(useComposerStore.getState().searchQuotes[`new:${generation}`]).toEqual([
      SOURCE_SELECTION,
    ]);
    store.confirmInput('created-session', input.requestId);
    expect(useComposerStore.getState().searchQuotes).toEqual({});
  });
});
