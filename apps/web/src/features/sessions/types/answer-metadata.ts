import type { MessageView } from '@my-pi-harness/protocol';

/** Recorded answer timestamp; request usage and elapsed time come from the host usage query. */
export interface AnswerTimestamp {
  timeLabel: string;
  timeTitle: string;
  dateTime: string;
}

/** One input's settled action row, anchored after all of its model and tool steps. */
export interface AnswerFooter {
  inputId: string;
  copyText: string;
  memoryMessage: MessageView;
  timestamp: AnswerTimestamp;
}
