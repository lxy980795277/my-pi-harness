/** Directory labels accept host path separators without exposing a path editing control. */
export const workspaceDirectoryName = (rootPath: string): string => {
  const segments = rootPath.replaceAll('\\', '/').split('/').filter(Boolean);
  return segments.at(-1) ?? rootPath;
};

/** A drop must identify one native file object; main separately verifies it is a directory. */
export const readWorkspaceDrop = (files: readonly File[]): File => {
  if (files.length !== 1) {
    throw new Error('每次只能添加一个文件夹。');
  }
  const file = files[0];
  if (file === undefined) {
    throw new Error('未能读取拖入的文件夹，请重新拖入。');
  }
  return file;
};
