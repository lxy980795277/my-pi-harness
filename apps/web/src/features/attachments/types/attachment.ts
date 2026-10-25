import type { Attachment } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ClipboardEvent, RefObject } from 'react';
import type { AsyncEvent } from '@/hooks/use-async-event';
import type { Action, InputChange, ValueChange } from '@/types/events';

export interface AttachmentComposerState {
  input: RefObject<HTMLInputElement | null>;
  open: boolean;
  setOpen: ValueChange<boolean>;
  choose: Action;
  chooseMcp: Action;
  chooseSkill: Action;
  changeFiles: InputChange;
  paste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  remove: ValueChange<string>;
  upload: AsyncEvent<[File[]]>;
}
export interface AttachmentPreviewState {
  open: boolean;
  setOpen: ValueChange<boolean>;
  show: Action;
  metadata: UseQueryResult<Attachment, Error>;
}
