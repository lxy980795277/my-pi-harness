import {
  AttachmentSchema,
  AttachmentContentSchema,
  type Attachment,
  type AttachmentContent,
  type AttachmentUpload,
} from '@my-pi-harness/protocol';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Uploads bounded original content through the authenticated host service. */
export const uploadAttachment = async (
  input: AttachmentUpload,
  signal: AbortSignal,
): Promise<Attachment> => {
  return parseResponse(
    AttachmentSchema,
    await requestJson('/attachments', 'POST', input, signal, 30_000),
  );
};
/** Reads public metadata independently of the attachment's original content. */
export const fetchAttachment = async (id: string, signal: AbortSignal): Promise<Attachment> => {
  return parseResponse(
    AttachmentSchema,
    await getJson(`/attachments/${encodeURIComponent(id)}`, signal),
  );
};
/** Reads original image bytes or extracted text only while its preview is open. */
export const fetchAttachmentContent = async (
  id: string,
  signal: AbortSignal,
): Promise<AttachmentContent> => {
  return parseResponse(
    AttachmentContentSchema,
    await getJson(`/attachments/${encodeURIComponent(id)}/content`, signal),
  );
};
