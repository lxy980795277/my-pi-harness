import type { RefObject } from 'react';
import type { Action } from '@/types/events';

export interface TimelineTarget {
  id: string;
  branchId: string;
  messageId: string;
}

export interface TimelineMessageLocation {
  index: number;
  processInputId: string | null;
}
export type MessageElementRef = (messageId: string, element: HTMLElement | null) => void;

export interface TimelineSeekState {
  cancel: Action;
  registerMessage: MessageElementRef;
  locating: RefObject<boolean>;
  error: string | null;
}
