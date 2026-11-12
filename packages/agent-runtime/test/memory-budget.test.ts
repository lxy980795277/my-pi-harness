import type { MemoryAdoptedEntry, MemorySelection } from '@my-pi-harness/protocol';
import { decodeMemoryBlock } from '@my-pi-harness/memory/snapshot';
import { describe, expect, it } from 'vitest';
import { memoryPrompt } from '../src/context/memory';

const fingerprint = 'a'.repeat(64);
const fixed: MemoryAdoptedEntry = {
  id: 'fixed',
  scope: { kind: 'user' },
  category: 'fact',
  mode: 'fixed',
  body: 'Keep this exact fixed fact.',
  revision: 1,
  source: { kind: 'manual' },
};
const related: MemoryAdoptedEntry = {
  ...fixed,
  id: 'related',
  mode: 'relevant',
  body: 'Relevant fact. '.repeat(500),
};
const selection: MemorySelection = {
  retrieval: 'hybrid',
  candidateCount: 2,
  matchedCount: 2,
  omittedCount: 1,
  omissions: [
    { id: 'unrelated', revision: 1, mode: 'relevant', reason: 'below-threshold', score: 0.1 },
  ],
};

describe('fixed-priority memory context allocation', () => {
  it('keeps complete fixed facts before related entries and audits budget omission without sending metadata', () => {
    const result = memoryPrompt(
      'base prompt',
      { fingerprint, entries: [related, fixed], selection },
      8000,
    );
    expect(result.snapshot?.entries).toEqual([fixed]);
    expect(result.snapshot?.selection).toMatchObject({
      candidateCount: 2,
      matchedCount: 2,
      omittedCount: 2,
    });
    expect(result.snapshot?.selection?.omissions).toEqual([
      { id: 'related', revision: 1, mode: 'relevant', reason: 'budget' },
      ...selection.omissions,
    ]);
    expect(result.prompt).not.toContain('below-threshold');
    expect(result.prompt).not.toContain('unrelated');
    if (!result.range) throw new Error('Missing adopted memory range');
    expect(decodeMemoryBlock(result.prompt, result.range)).toEqual({
      fingerprint,
      entries: [fixed],
    });
    expect(result.tokens).toBeLessThanOrEqual(400);
  });

  it('allows zero related adoption without an empty prompt block and preserves its explanation', () => {
    const result = memoryPrompt(
      'base prompt',
      { fingerprint, entries: [related], selection },
      8000,
    );
    expect(result.prompt).toBe('base prompt');
    expect(result.range).toBeUndefined();
    expect(result.tokens).toBe(0);
    expect(result.snapshot?.selection?.omittedCount).toBe(2);
  });

  it.each([
    { allowUse: false, allowLearning: true },
    { allowUse: true, allowLearning: false },
    { allowUse: true, allowLearning: true },
  ])('renders current policy without a JSON fact block for $allowUse/$allowLearning', (policy) => {
    const result = memoryPrompt('base', { fingerprint, entries: [], policy }, 8000);
    expect(result.prompt).toContain(
      `use=${policy.allowUse ? 'on' : 'off'}; learning=${policy.allowLearning ? 'on' : 'off'}`,
    );
    expect(result.prompt).toContain(
      `Automatic learning is ${policy.allowUse && policy.allowLearning ? 'enabled' : 'disabled'}`,
    );
    expect(result.prompt.split('Current long-term memory settings:')).toHaveLength(2);
    expect(result.range).toBeUndefined();
    expect(result.tokens).toBe(0);
    expect(result.snapshot?.policy).toEqual(policy);
  });

  it('keeps current settings outside the single memory JSON block', () => {
    const policy = { allowUse: true, allowLearning: false };
    const result = memoryPrompt('base', { fingerprint, entries: [fixed], policy }, 8000);
    if (!result.range) throw new Error('Missing memory range');
    expect(decodeMemoryBlock(result.prompt, result.range)).toEqual({
      fingerprint,
      entries: [fixed],
    });
    expect(result.prompt.slice(result.range.start, result.range.end)).not.toContain('policy');
    expect(result.prompt.split('Current long-term memory settings:')).toHaveLength(2);
  });

  it('never silently truncates or drops fixed facts to fit related ones', () => {
    expect(() =>
      memoryPrompt(
        'base',
        { fingerprint, entries: [{ ...fixed, body: 'fixed'.repeat(3000) }, related], selection },
        8000,
      ),
    ).toThrow('fixed');
  });
});
