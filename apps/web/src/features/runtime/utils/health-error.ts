/** Gives health failures a recovery action before private application surfaces mount. */
export const describeHealthError = (error: Error): string => {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return '本机服务响应超时，请检查服务后重试。';
  }

  if (error instanceof TypeError) {
    return '无法连接本机服务，请确认 daemon 已启动后重试。';
  }

  if (error instanceof SyntaxError) {
    return '本机服务返回了无法解析的数据，请重启本机服务后重新连接。';
  }

  return error.message;
};
