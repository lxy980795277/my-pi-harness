interface SnapshotPosition {
  snapshotSeq: number;
  liveRevision: number;
}

/** Recorded progress wins over any earlier partial text; equal facts use their live revision. */
export const isNewerSnapshot = (incoming: SnapshotPosition, current: SnapshotPosition): boolean => {
  return (
    incoming.snapshotSeq > current.snapshotSeq ||
    (incoming.snapshotSeq === current.snapshotSeq && incoming.liveRevision > current.liveRevision)
  );
};
