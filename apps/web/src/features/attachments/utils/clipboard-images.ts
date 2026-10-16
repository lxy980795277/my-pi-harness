/** Only actual clipboard image files are uploaded; ordinary text keeps the browser paste behavior. */
export const clipboardImages = (
  items: Iterable<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>,
): File[] => {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return files;
};
