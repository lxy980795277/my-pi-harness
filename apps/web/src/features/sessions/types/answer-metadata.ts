/** Display-ready facts for one settled answer, including all of its model steps. */
export interface AnswerMetadata {
  tokensLabel: string;
  tokensTitle: string;
  durationLabel: string;
  durationTitle: string;
  timeLabel: string;
  timeTitle: string;
  dateTime: string;
}

/** One input's settled action row, anchored after all of its model and tool steps. */
export interface AnswerFooter {
  inputId: string;
  copyText: string;
  metadata: AnswerMetadata;
}
