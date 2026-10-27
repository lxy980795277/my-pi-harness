const PARENT_POLL_INTERVAL_MS = 1_000;

/**
 * Stop a managed daemon when its launching process no longer exists.
 * @param parentPid The launching process ID supplied by the desktop supervisor.
 * @param onExit Called once when the parent has exited.
 * @param onError Receives unexpected operating-system probe failures.
 * @returns A disposer that stops the periodic parent check.
 */
export function watchParentProcess(
  parentPid: number,
  onExit: () => void,
  onError: (error: unknown) => void,
): () => void {
  let isStopped = false;
  const probe = (): void => {
    if (isStopped) return;
    try {
      process.kill(parentPid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'EPERM') return;
        if (error.code === 'ESRCH') {
          isStopped = true;
          clearInterval(timer);
          onExit();
          return;
        }
      }
      isStopped = true;
      clearInterval(timer);
      onError(error);
    }
  };
  const timer = setInterval(probe, PARENT_POLL_INTERVAL_MS);
  timer.unref();
  probe();
  return (): void => {
    isStopped = true;
    clearInterval(timer);
  };
}
