interface ChangeStreamResponse {
  readonly destroyed: boolean;
  write(chunk: string): boolean;
  end(): unknown;
  destroy(): unknown;
  once(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
}

interface AgentChangeStreamOptions {
  response: ChangeStreamResponse;
  subscribe(listener: () => void): () => void;
  authorized(): boolean;
  watchAuthorization(listener: () => void): () => void;
  onClose(): void;
}

/** A shared invalidation stream carries no task text and disconnects slow consumers. */
export function startAgentChangeStream(options: AgentChangeStreamOptions): () => void {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = (): void => undefined;
  let unwatch = (): void => undefined;
  const releaseSubscriptions = (): void => {
    const stopSubscription = unsubscribe;
    const stopAuthorization = unwatch;
    unsubscribe = (): void => undefined;
    unwatch = (): void => undefined;
    stopSubscription();
    stopAuthorization();
  };
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearInterval(heartbeat);
    releaseSubscriptions();
    options.response.off('close', cleanup);
    options.onClose();
  };
  const close = (): void => {
    if (closed) return;
    cleanup();
    try {
      options.response.end();
    } catch {
      // A response that cannot finish after cleanup must release its socket.
      options.response.destroy();
    }
  };
  const abort = (): void => {
    if (closed) return;
    cleanup();
    options.response.destroy();
  };
  const send = (kind: 'ready' | 'changed'): void => {
    timer = undefined;
    if (closed) return;
    if (options.response.destroyed) {
      cleanup();
      return;
    }
    try {
      if (!options.authorized()) {
        close();
        return;
      }
      if (!options.response.write(`event: agents.changed\ndata: ${JSON.stringify({ kind })}\n\n`))
        abort();
    } catch {
      // An invalid authorization or unwritable socket cannot retain a private subscription.
      abort();
    }
  };
  const changed = (): void => {
    if (!closed && timer === undefined) timer = setTimeout(() => send('changed'), 100);
  };
  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      if (!options.authorized()) close();
      else if (!options.response.write(': heartbeat\n\n')) abort();
    } catch {
      // A lost authorization store or socket must release this connection's subscriptions.
      abort();
    }
  }, 15_000);
  options.response.once('close', cleanup);
  try {
    unsubscribe = options.subscribe(changed);
    unwatch = options.watchAuthorization(close);
    if (closed) {
      releaseSubscriptions();
    } else send('ready');
  } catch {
    abort();
  }
  return close;
}
