import { fauxAssistantMessage, type Message } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { estimateContextUsage, fitContext } from '../src/context/budget.js';

function user(content: string): Message {
  return { role: 'user', content, timestamp: 1 };
}
function exchange(id: string, text = 'Tool output'): Message[] {
  return [
    fauxAssistantMessage(
      [{ type: 'toolCall', id, name: 'read_file', arguments: { path: 'a.txt' } }],
      { stopReason: 'toolUse' },
    ),
    {
      role: 'toolResult',
      toolCallId: id,
      toolName: 'read_file',
      content: [{ type: 'text', text }],
      isError: false,
      timestamp: 2,
    },
  ];
}
const budget = { systemPrompt: 'Application rules', contextWindow: 2000, maxOutput: 500 };

describe('context estimation and complete-turn fitting', () => {
  it('counts Unicode, images, signatures and tool declarations while excluding base64 length and billing usage', () => {
    const plain = estimateContextUsage([user('one')], '', 10_000, 1000);
    const unicode = estimateContextUsage([user('中文测试')], '', 10_000, 1000);
    expect(unicode.estimatedTokens).toBeGreaterThan(plain.estimatedTokens);
    const image = (data: string): Message => ({
      role: 'user',
      timestamp: 1,
      content: [{ type: 'image', data, mimeType: 'image/png' }],
    });
    const shortImage = estimateContextUsage([image('YWJj')], '', 10_000, 1000);
    const largeImage = estimateContextUsage([image('YWJj'.repeat(100_000))], '', 10_000, 1000);
    expect(shortImage).toEqual(largeImage);
    expect(shortImage.estimatedTokens).toBeGreaterThan(4096);
    const assistant = fauxAssistantMessage([
      { type: 'thinking', thinking: 'Idea', thinkingSignature: 'opaque-signature'.repeat(100) },
    ]);
    const withSignature = estimateContextUsage([assistant], '', 10_000, 1000);
    assistant.usage.input = 1_000_000;
    expect(estimateContextUsage([assistant], '', 10_000, 1000)).toEqual(withSignature);
    expect(withSignature.estimatedTokens).toBeGreaterThan(plain.estimatedTokens);
    const withTool = estimateContextUsage([], '', 10_000, 1000, [
      { name: 'example', description: 'Read bounded text', parameters: { type: 'object' } },
    ]);
    expect(withTool.estimatedTokens).toBeGreaterThan(
      estimateContextUsage([], '', 10_000, 1000).estimatedTokens,
    );
    expect(plain).toMatchObject({
      windowTokens: 10_000,
      reservedOutput: 1000,
      inputBudget: 9000,
      trimmedMessages: 0,
    });
  });

  it('drops old whole turns, including complete tool cycles, and preserves latest tool results', () => {
    const messages = [
      user('Old task'),
      ...exchange('old', 'x'.repeat(6000)),
      fauxAssistantMessage('Old answer'),
      user('Latest task'),
      ...exchange('new'),
    ];
    const result = fitContext({ ...budget, messages });
    expect(result.messages).toEqual(messages.slice(4));
    expect(result.usage.trimmedMessages).toBe(4);
    expect(result.usage.estimatedTokens).toBeLessThanOrEqual(result.usage.inputBudget);
    expect(result.messages.filter((message) => message.role === 'toolResult')).toHaveLength(1);
    expect(messages).toHaveLength(7);
  });

  it('keeps system updates and refuses to remove oversized latest input, rules or current tool cycle', () => {
    const system: Message = { role: 'system', content: 'Keep this policy', timestamp: 1 };
    const messages = [system, user('x'.repeat(6000)), fauxAssistantMessage('old'), user('Latest')];
    const result = fitContext({ ...budget, messages });
    expect(result.messages).toEqual([system, messages[3]]);
    expect(() => fitContext({ ...budget, messages: [user('x'.repeat(6000))] })).toThrow(
      expect.objectContaining({ code: 'CONTEXT_LIMIT' }),
    );
    expect(() =>
      fitContext({ ...budget, messages: [user('Small')], systemPrompt: 'x'.repeat(6000) }),
    ).toThrow(expect.objectContaining({ code: 'CONTEXT_LIMIT' }));
    expect(() =>
      fitContext({
        ...budget,
        messages: [user('Current'), ...exchange('current', 'x'.repeat(6000))],
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTEXT_LIMIT' }));
  });

  it('rejects incomplete, duplicate, mismatched and orphaned tool exchanges', () => {
    const cycle = exchange('call');
    expect(() => fitContext({ ...budget, messages: cycle.slice(0, 1) })).toThrow(
      expect.objectContaining({ code: 'CONTEXT_TOOL_PAIR' }),
    );
    expect(() => fitContext({ ...budget, messages: cycle.slice(1) })).toThrow(
      expect.objectContaining({ code: 'CONTEXT_TOOL_PAIR' }),
    );
    const result = cycle[1];
    if (!result || result.role !== 'toolResult') throw new Error('Missing fixture result');
    expect(() => fitContext({ ...budget, messages: [...cycle, result] })).toThrow(
      expect.objectContaining({ code: 'CONTEXT_TOOL_PAIR' }),
    );
    expect(() =>
      fitContext({ ...budget, messages: [cycle[0] ?? user(''), { ...result, toolName: 'other' }] }),
    ).toThrow(expect.objectContaining({ code: 'CONTEXT_TOOL_PAIR' }));
    const call = { type: 'toolCall' as const, id: 'same', name: 'read_file', arguments: {} };
    expect(() =>
      fitContext({ ...budget, messages: [fauxAssistantMessage([call, call]), result] }),
    ).toThrow(expect.objectContaining({ code: 'CONTEXT_TOOL_PAIR' }));
  });

  it('allows reused provider call IDs across distinct complete turns', () => {
    const messages = [user('First'), ...exchange('call_0'), user('Second'), ...exchange('call_0')];
    expect(fitContext({ ...budget, messages }).messages).toEqual(messages);
  });

  it('rejects invalid output reservation instead of silently changing model settings', () => {
    expect(() => estimateContextUsage([], '', 200, 200)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTEXT_BUDGET' }),
    );
    expect(() => estimateContextUsage([], '', 200, -1)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTEXT_BUDGET' }),
    );
    expect(() => estimateContextUsage([], '', Number.NaN, 10)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTEXT_BUDGET' }),
    );
  });
});
