export interface RefreshOwner {
  dirty: boolean;
  closed: boolean;
}

/** Drains subscription changes arriving during a read without changing click deduplication. */
export const drainInvalidations = async (
  signal: AbortSignal,
  owner: RefreshOwner,
  invalidate: () => Promise<void>,
): Promise<void> => {
  while (owner.dirty && !owner.closed && !signal.aborted) {
    owner.dirty = false;
    await invalidate();
  }
};
