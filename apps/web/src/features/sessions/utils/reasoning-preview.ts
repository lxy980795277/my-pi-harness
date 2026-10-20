/** Keeps the collapsed reasoning row to a short plain-text preview. */
export const reasoningPreview = (thinking: string): string => {
  const preview = thinking.replace(/\s+/gu, ' ').trim();
  if (preview.length <= 160) return preview;
  return `${preview.slice(0, 160)}…`;
};
