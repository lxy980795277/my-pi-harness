import type { AttachmentComposerState } from '@/features/attachments/types/attachment';
import { useCallback, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadAttachment } from '@/features/attachments/services/attachments';
import {
  useAttachmentDrafts,
  EMPTY_ATTACHMENTS,
} from '@/features/attachments/stores/attachment-drafts';
import { clipboardImages } from '@/features/attachments/utils/clipboard-images';
import { fileToUpload } from '@/features/attachments/utils/attachment-upload';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Owns native file selection and upload cancellation without caching base64 payloads. */
export const useAttachmentComposer = (
  draftKey: string,
  locked: boolean,
): AttachmentComposerState => {
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const items = useAttachmentDrafts((state) => {
    return state.drafts[draftKey] ?? EMPTY_ATTACHMENTS;
  });
  const add = useAttachmentDrafts((state) => {
    return state.add;
  });
  const setBusy = useAttachmentDrafts((state) => {
    return state.setBusy;
  });
  const removeDraft = useAttachmentDrafts((state) => {
    return state.remove;
  });
  const [open, setOpen] = useState(false);
  const upload = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, files: File[]): Promise<void> => {
        if (locked) {
          return;
        }
        if (items.length + files.length > 8) {
          throw new Error('每条消息最多添加 8 个附件。');
        }
        setBusy(draftKey, true);
        try {
          for (const file of files) {
            const attachment = await uploadAttachment(await fileToUpload(file, signal), signal);
            signal.throwIfAborted();
            client.setQueryData(['attachment', attachment.id], attachment);
            add(draftKey, attachment);
          }
        } finally {
          setBusy(draftKey, false);
        }
      },
      [add, client, draftKey, items.length, locked, setBusy],
    ),
  );
  const { run } = upload;
  const choose = useCallback((): void => {
    setOpen(false);
    input.current?.click();
  }, []);
  const changeFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const selectedFiles = event.target.files;
      if (selectedFiles === null) {
        return;
      }
      const files = Array.from(selectedFiles);
      event.target.value = '';
      if (files.length > 0) {
        run(files);
      }
    },
    [run],
  );
  const paste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      if (locked || upload.pending) {
        return;
      }
      const files = clipboardImages(event.clipboardData.items);
      if (files.length > 0) {
        event.preventDefault();
        run(files);
      }
    },
    [locked, run, upload.pending],
  );
  const remove = useCallback(
    (id: string): void => {
      if (!locked && !upload.pending) {
        removeDraft(draftKey, id);
      }
    },
    [draftKey, locked, removeDraft, upload.pending],
  );
  return {
    input,
    open,
    setOpen,
    choose,
    changeFiles,
    paste,
    remove,
    upload,
  };
};
