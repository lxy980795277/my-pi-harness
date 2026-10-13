import type { ReadableStreamDefaultReader } from 'node:stream/web';

/** Read one complete SSE record without assuming HTTP chunk boundaries. */
export async function readSseRecord(reader: ReadableStreamDefaultReader<unknown>): Promise<string> {
  const decoder = new TextDecoder();
  let source = '';
  while (!source.includes('\n\n')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('SSE response ended before a complete record');
    if (!(chunk.value instanceof Uint8Array)) throw new Error('SSE response did not provide bytes');
    source += decoder.decode(chunk.value, { stream: true });
  }
  return source;
}
