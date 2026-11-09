import {
  ATTACHMENT_BYTE_LIMITS,
  ATTACHMENT_FORMATS,
  ATTACHMENT_IMAGE_BASE64_LENGTH,
  ATTACHMENT_MAX_BASE64_LENGTH,
  ATTACHMENT_MAX_BYTES,
  AttachmentContentSchema,
  AttachmentSchema,
  AttachmentUploadSchema,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { documentFormat } from '../src/attachments/content';

describe('shared attachment declarations', () => {
  it('retains public validation limits derived from the byte budgets', () => {
    const attachment = {
      id: 'attachment',
      name: 'fixture.pdf',
      kind: 'pdf',
      mediaType: 'application/pdf',
      byteLength: ATTACHMENT_MAX_BYTES,
      preview: '',
      sourcePath: null,
      createdAt: 1,
    };
    expect(Value.Check(AttachmentSchema, attachment)).toBe(true);
    expect(
      Value.Check(AttachmentSchema, { ...attachment, byteLength: ATTACHMENT_MAX_BYTES + 1 }),
    ).toBe(false);
    const upload = {
      name: 'fixture.pdf',
      mediaType: 'application/pdf',
      data: 'A'.repeat(ATTACHMENT_MAX_BASE64_LENGTH),
    };
    expect(Value.Check(AttachmentUploadSchema, upload)).toBe(true);
    expect(Value.Check(AttachmentUploadSchema, { ...upload, data: `${upload.data}A` })).toBe(false);
    const content = {
      attachment,
      text: 'x'.repeat(ATTACHMENT_BYTE_LIMITS.text),
      imageData: 'A'.repeat(ATTACHMENT_IMAGE_BASE64_LENGTH),
    };
    expect(Value.Check(AttachmentContentSchema, content)).toBe(true);
    expect(Value.Check(AttachmentContentSchema, { ...content, text: `${content.text}x` })).toBe(
      false,
    );
    expect(
      Value.Check(AttachmentContentSchema, { ...content, imageData: `${content.imageData}A` }),
    ).toBe(false);
  });

  it('selects every declared document parser while continuing to reject mismatched MIME', () => {
    for (const format of ATTACHMENT_FORMATS) {
      if (format.kind !== 'document') continue;
      for (const extension of format.extensions) {
        const name = `sample.${extension.toUpperCase()}`;
        expect(documentFormat(name, format.mediaType)).toBe(format.parser);
        expect(documentFormat(name, 'application/octet-stream')).toBe(format.parser);
        for (const alias of format.aliases ?? []) {
          expect(documentFormat(name, alias)).toBe(format.parser);
        }
        expect(() => documentFormat(name, 'image/png')).toThrow('文档类型');
      }
    }
    expect(documentFormat('source.ts', 'text/plain')).toBeUndefined();
    expect(documentFormat('unknown.exe', 'application/octet-stream')).toBeUndefined();
  });
});
