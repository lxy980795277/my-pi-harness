import { describe, expect, it } from 'vitest';
import type {
  ComposerCompositionState,
  ComposerKey,
} from '../src/features/sessions/types/composer';
import { shouldSubmitComposerKey } from '../src/features/sessions/utils/composer-key-down';

const enter = (overrides: Partial<ComposerKey> = {}): ComposerKey => {
  return {
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    isComposing: false,
    timeStamp: 100,
    ...overrides,
  };
};

const idle: ComposerCompositionState = { active: false, endedAt: null };

describe('composer keyboard submission', () => {
  it('sends Enter while preserving line breaks and unrelated keys', () => {
    expect(shouldSubmitComposerKey(enter(), idle)).toBe(true);
    expect(shouldSubmitComposerKey(enter({ shiftKey: true }), idle)).toBe(false);
    expect(shouldSubmitComposerKey(enter({ altKey: true }), idle)).toBe(false);
    expect(shouldSubmitComposerKey(enter({ key: 'a' }), idle)).toBe(false);
  });

  it('keeps IME confirmation in the editor when either native or lifecycle composition is active', () => {
    expect(shouldSubmitComposerKey(enter({ isComposing: true }), idle)).toBe(false);
    expect(shouldSubmitComposerKey(enter(), { active: true, endedAt: null })).toBe(false);
  });

  it('ignores the final IME Enter when compositionend arrives before keydown', () => {
    const ended = { active: false, endedAt: 100 };
    expect(shouldSubmitComposerKey(enter(), ended)).toBe(false);
    expect(shouldSubmitComposerKey(enter({ timeStamp: 149 }), ended)).toBe(false);
    expect(shouldSubmitComposerKey(enter({ timeStamp: 150 }), ended)).toBe(true);
  });

  it('allows a later deliberate Enter after mouse selection ends composition without a keyup', () => {
    expect(
      shouldSubmitComposerKey(enter({ timeStamp: 500 }), { active: false, endedAt: 100 }),
    ).toBe(true);
  });
});
