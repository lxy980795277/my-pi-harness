import { describe, expect, it } from 'vitest';
import { ATTACHMENT_BYTE_LIMITS, ATTACHMENT_FORMATS } from '@my-pi-harness/protocol';
import { clipboardImages } from '../src/features/attachments/utils/clipboard-images';
import { titleFromFirstMessage } from '../src/features/sessions/utils/composer-options';
import {
  ATTACHMENT_ACCEPT,
  fileToUpload,
} from '../src/features/attachments/utils/attachment-upload';

describe('attachment-only and clipboard input', () => {
  it('offers every declared extension and infers its MIME when the browser supplies none', async () => {
    for (const format of ATTACHMENT_FORMATS) {
      expect(ATTACHMENT_ACCEPT.split(',')).toContain(format.mediaType);
      for (const extension of format.extensions) {
        expect(ATTACHMENT_ACCEPT.split(',')).toContain(`.${extension}`);
        const input = new File(['fixture'], `sample.${extension}`);
        const upload = await fileToUpload(input, new AbortController().signal);
        expect(upload.mediaType).toBe(format.mediaType);
      }
    }
  });

  it('applies image and text limits before reading selected file bytes', async () => {
    for (const [name, type, limit] of [
      ['large.png', 'image/png', ATTACHMENT_BYTE_LIMITS.image],
      ['large.txt', 'text/plain', ATTACHMENT_BYTE_LIMITS.text],
    ] as const) {
      const input = new File([new Uint8Array(limit + 1)], name, { type });
      await expect(fileToUpload(input, new AbortController().signal)).rejects.toThrow('大小限制');
    }
  });

  it('uses the first file name for an attachment-only conversation title', () => {
    expect(titleFromFirstMessage('  ', [{ name: 'requirements.docx' }])).toBe('requirements.docx');
    expect(titleFromFirstMessage('  Summarize\n this ', [{ name: 'ignored.pdf' }])).toBe(
      'Summarize this',
    );
  });
  it('extracts image files without consuming normal text or null clipboard entries', () => {
    const image = new File(['image'], 'clipboard.png', { type: 'image/png' });
    const items = [
      {
        kind: 'string',
        type: 'text/plain',
        getAsFile: (): File | null => {
          return null;
        },
      },
      {
        kind: 'file',
        type: 'image/png',
        getAsFile: (): File | null => {
          return image;
        },
      },
      {
        kind: 'file',
        type: 'image/png',
        getAsFile: (): File | null => {
          return null;
        },
      },
      {
        kind: 'file',
        type: 'application/pdf',
        getAsFile: (): File | null => {
          return new File(['pdf'], 'file.pdf');
        },
      },
    ];
    expect(clipboardImages(items)).toEqual([image]);
    expect(clipboardImages(items.slice(0, 1))).toEqual([]);
  });
  it('allows supported documents beyond the text upload limit and preserves their MIME type', async () => {
    const document = new File([new Uint8Array(256_001)], 'notes.docx');
    expect((await fileToUpload(document, new AbortController().signal)).mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    await expect(
      fileToUpload(
        new File([new Uint8Array(8_388_609)], 'oversize.rtf'),
        new AbortController().signal,
      ),
    ).rejects.toThrow('大小限制');
  });
});
