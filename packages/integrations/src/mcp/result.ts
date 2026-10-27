import type { CallToolResult } from '@modelcontextprotocol/client';
import { containsSecret } from './catalog.js';
import { McpError } from './errors.js';
import type { McpCallOutcome, McpResultContent } from './types.js';

const TEXT_LIMIT = 128000;
const IMAGE_LIMIT = 2 * 1024 * 1024;
const CONTENT_BLOCK_LIMIT = 128;

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return undefined;
}

/** Projects content without fetching resources or interpreting audio as images. */
export function projectMcpResult(
  result: CallToolResult,
  secrets: readonly string[],
): Extract<McpCallOutcome, { kind: 'known' }> {
  if (containsSecret(result, secrets))
    throw new McpError('SECRET_ECHO', 'The server returned credential-bearing content');
  const content: McpResultContent[] = [];
  let textCharacters = 0;
  let imageBytes = 0;
  const append = (block: McpResultContent): void => {
    if (content.length >= CONTENT_BLOCK_LIMIT)
      throw new McpError('RESULT_LIMIT', 'The local tool result exceeded its content block limit');
    content.push(block);
  };
  const text = (value: string): void => {
    textCharacters += value.length;
    if (textCharacters > TEXT_LIMIT)
      throw new McpError('RESULT_LIMIT', 'The local tool result exceeded its text limit');
    append({ type: 'text', text: value });
  };
  for (const block of result.content) {
    switch (block.type) {
      case 'text':
        text(block.text);
        break;
      case 'image': {
        const image = Buffer.from(block.data, 'base64');
        imageBytes += image.byteLength;
        if (
          imageBytes > IMAGE_LIMIT ||
          imageMime(image) !== block.mimeType ||
          image.toString('base64') !== block.data
        )
          throw new McpError(
            'RESULT_LIMIT',
            'The local tool returned an unsupported or oversized image',
          );
        append({ type: 'image', data: block.data, mimeType: block.mimeType });
        break;
      }
      case 'resource_link':
        text(`[MCP resource link; not fetched] ${block.name}: ${block.uri}`);
        break;
      case 'resource': {
        if ('text' in block.resource)
          text(`[MCP embedded text resource] ${block.resource.uri}\n${block.resource.text}`);
        else text(`[MCP embedded binary resource; not opened] ${block.resource.uri}`);
        break;
      }
      case 'audio':
        text(`[MCP audio content; not decoded] ${block.mimeType}`);
        break;
      default:
        throw new McpError('UNSUPPORTED_RESULT', 'The local tool returned unsupported content');
    }
  }
  if (result.structuredContent !== undefined)
    text(`[MCP structured content]\n${JSON.stringify(result.structuredContent)}`);
  if (content.length === 0) text('[MCP tool completed without content]');
  const first = content.find((entry) => entry.type === 'text');
  return {
    kind: 'known',
    isError: result.isError === true,
    content,
    summary: first?.text.slice(0, 500) ?? 'MCP tool returned image content',
  };
}
