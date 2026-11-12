import { describe, expect, it } from 'vitest';
import { DEFAULT_MEMORY_SETTINGS, normalizeMemorySave, normalizeMemoryUpdate } from '../src/index';

describe('direct memory write policy', () => {
  it('enables usage and automatic learning without persisting settings', () => {
    expect(DEFAULT_MEMORY_SETTINGS).toEqual({ allowUse: true, allowLearning: true, revision: 0 });
  });

  it.each(['fact', 'preference', 'instruction'] as const)(
    'defaults explicit %s saves to fixed',
    (category) => {
      expect(
        normalizeMemorySave({ scope: 'user', category, body: '  Saved\r\ntext  ' }, 'save'),
      ).toEqual({
        scope: 'user',
        category,
        body: 'Saved\ntext',
        mode: 'fixed',
      });
    },
  );

  it.each([
    ['fact', 'relevant'],
    ['preference', 'fixed'],
    ['instruction', 'fixed'],
  ] as const)('defaults learned %s to %s', (category, mode) => {
    expect(
      normalizeMemorySave({ scope: 'user', category, body: 'Learned text' }, 'learn').mode,
    ).toBe(mode);
  });

  it('preserves an explicit mode and leaves an omitted update mode for the existing entry', () => {
    expect(
      normalizeMemorySave(
        { scope: 'workspace', category: 'fact', body: 'Text', mode: 'fixed' },
        'learn',
      ).mode,
    ).toBe('fixed');
    expect(
      normalizeMemoryUpdate({
        memoryId: 'memory',
        expectedRevision: 2,
        category: 'fact',
        body: ' Text ',
      }),
    ).toEqual({
      memoryId: 'memory',
      expectedRevision: 2,
      category: 'fact',
      body: 'Text',
    });
  });
});
