import type { ModelInfo } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { archiveBindingThinking } from '../src/features/archives/utils/archive-binding';

const model = (levels: ModelInfo['supportedThinkingLevels']): ModelInfo => {
  return {
    id: 'reasoning-only',
    name: 'Reasoning model',
    api: 'openai-completions',
    contextWindow: 32000,
    maxTokens: 2048,
    reasoning: true,
    input: ['text'],
    supportedThinkingLevels: levels,
  };
};

describe('current-model archive binding options', () => {
  it('uses off only when supported and otherwise selects the lowest valid visible level', () => {
    expect(archiveBindingThinking(model(['high', 'low']), null)).toBe('low');
    expect(archiveBindingThinking(model(['medium', 'off', 'high']), null)).toBe('off');
    expect(archiveBindingThinking(model(['max']), 'off')).toBe('max');
  });

  it('keeps a supported explicit choice, revalidates changed capabilities and never invents a loading default', () => {
    expect(archiveBindingThinking(model(['low', 'high']), 'high')).toBe('high');
    expect(archiveBindingThinking(model(['medium', 'high']), 'low')).toBe('medium');
    expect(archiveBindingThinking(undefined, 'off')).toBeNull();
  });
});
