import { Type } from 'typebox';
import { DocumentError } from '../utils/document-text';
import { readDocumentInput } from '../lib/document-input';
import { completeToolRegistration } from '../lib/tool-registry';

const parameters = Type.Object(
  { path: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
);

/** Return actual image bytes only when the model supports image input. */
export const viewImageTool = completeToolRegistration({
  name: 'view_image',
  description: 'View actual PNG, JPEG, GIF or WebP image bytes from the workspace.',
  parameters,
  scope: 'workspace',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.images,
  async execute(ports, args, invocation) {
    const context = await ports.workspace(invocation.signal);
    const bytes = await readDocumentInput(args.path, context, 6_000_000);
    const mimeType = imageMime(bytes);
    if (mimeType === undefined)
      throw new DocumentError('IMAGE_FAILED', 'Use a PNG, JPEG, GIF or WebP image');
    return {
      summary: `Viewed image ${args.path}`,
      content: [
        { type: 'text', text: `Image: ${args.path}` },
        { type: 'image', data: bytes.toString('base64'), mimeType },
      ],
    };
  },
});

function imageMime(data: Buffer): string | undefined {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return undefined;
}
