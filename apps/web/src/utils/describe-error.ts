/** Converts a caught failure into product text without dumping request input. */
export const describeError = (failure: unknown): string => {
  if (failure instanceof Error) {
    if (failure.name === 'TimeoutError') {
      return '请求超时，请检查本机服务后重试。';
    }
    if (failure.name === 'AbortError') {
      return '请求已取消。';
    }
    return failure.message;
  }
  return '操作失败，请重试。';
};
