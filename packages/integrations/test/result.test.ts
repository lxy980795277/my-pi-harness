import { describe, expect, it } from 'vitest';
import { projectMcpResult } from '../src/result.js';

describe('bounded MCP content projection', () => {
  it('retains structured reasoning data and text resource origins without fetching links or casting audio', () => {
    const result = projectMcpResult(
      {
        content: [
          { type: 'resource_link', name: 'reference', uri: 'https://example.test/resource' },
          { type: 'resource', resource: { uri: 'fixture://document', text: 'document text' } },
          { type: 'audio', data: 'ZmFrZQ==', mimeType: 'audio/wav' },
        ],
        structuredContent: { answer: 42 },
      },
      [],
    );
    expect(result.content.every((entry) => entry.type === 'text')).toBe(true);
    expect(JSON.stringify(result)).toContain('not fetched');
    expect(JSON.stringify(result)).toContain('document text');
    expect(JSON.stringify(result)).toContain('not decoded');
    expect(JSON.stringify(result)).toContain('42');
  });
  it('does not expose secret values in nested structured content or resource keys', () => {
    expect(() => {
      projectMcpResult(
        { content: [], structuredContent: { nested: { key: 'fake-secret-value' } } },
        ['fake-secret-value'],
      );
    }).toThrow('credential-bearing');
  });
  it('bounds aggregate text and rejects a spoofed image MIME signature', () => {
    expect(() => {
      projectMcpResult(
        {
          content: [
            { type: 'text', text: 'x'.repeat(64001) },
            { type: 'text', text: 'x'.repeat(64000) },
          ],
        },
        [],
      );
    }).toThrow('text limit');
    expect(() => {
      projectMcpResult(
        {
          content: [
            {
              type: 'image',
              mimeType: 'image/png',
              data: Buffer.from('not an image').toString('base64'),
            },
          ],
        },
        [],
      );
    }).toThrow('image');
  });
});
