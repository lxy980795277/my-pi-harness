import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { pruneContext } from '../src/context/projection';

function result(text: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: 'provider-call',
    toolName: 'example',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 1,
  };
}

describe('model-visible tool-result projection', () => {
  it('provides the retained host identity and offset without changing the original result', () => {
    const text = 'Retained source text.\n'.repeat(1000);
    const message = result(text);
    const projected = pruneContext(
      [message],
      false,
      new Map([[message, { id: 'host-record', text }]]),
    );
    const output = JSON.stringify(projected.messages);
    const first = projected.messages[0];
    if (first?.role !== 'toolResult' || first.content[0]?.type !== 'text')
      throw new Error('missing projected text');
    expect(first.content[0].text).toContain(
      'read_tool_result({"toolCallId":"host-record","offset":4096,"maxCharacters":6000})',
    );
    expect(output).not.toContain('search_session_history');
    expect(projected.requiredTools).toEqual(['read_tool_result']);
    expect(projected.prunedMessages).toBe(1);
    expect(projected.messages[0]).not.toBe(message);
    expect(message.content).toEqual([{ type: 'text', text }]);
  });

  it('uses retained-text offsets across multiple content blocks', () => {
    const text = 'x'.repeat(10_000);
    const message = result('Header');
    message.content.push({ type: 'text', text });
    const projected = pruneContext(
      [message],
      false,
      new Map([[message, { id: 'host-record', text: `Header\n${text}` }]]),
    );
    expect(JSON.stringify(projected.messages)).toContain('4103');
    expect(projected.requiredTools).toEqual(['read_tool_result']);
  });

  it('does not promise recovery when retained text is absent, different or shorter than the omitted prefix', () => {
    const message = result('x'.repeat(10_000));
    const missing = pruneContext([message], false);
    const different = pruneContext(
      [message],
      false,
      new Map([[message, { id: 'other', text: 'y'.repeat(10_000) }]]),
    );
    const limited = pruneContext(
      [message],
      false,
      new Map([[message, { id: 'short', text: 'x'.repeat(2000) }]]),
    );
    for (const projection of [missing, different, limited]) {
      expect(projection.requiredTools).toEqual([]);
      expect(JSON.stringify(projection.messages)).not.toContain('read_tool_result(');
      expect(JSON.stringify(projection.messages)).toContain('no retained reader reference');
    }
  });
});
