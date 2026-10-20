import { parseExternalUrl } from '@my-pi-harness/protocol';

/** Only explicit HTTP(S) destinations may leave the application through Markdown. */
export const getMarkdownUrl = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  try {
    return parseExternalUrl(value);
  } catch {
    // Invalid model-authored URLs stay readable without becoming navigation targets.
    return undefined;
  }
};
