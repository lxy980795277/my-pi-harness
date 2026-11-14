import type { JournalRecord } from './journal-codec';
import { StorageError } from '../shared/errors';

/** Byte location of one checksum-protected batch and its record within that batch. */
export interface JournalAddress {
  offset: number;
  length: number;
  record: number;
}
export interface MessageAddress {
  address: JournalAddress;
  index: number;
}
export interface SnapshotAddress {
  address: JournalAddress;
  messages: readonly MessageAddress[];
}

/** Metadata-only index rebuilt during the existing authoritative replay. */
export class JournalIndex {
  private readonly records = new Map<number, JournalAddress>();
  private readonly snapshots = new Map<number, SnapshotAddress>();
  private readonly baselines = new Map<string, Map<string, readonly MessageAddress[]>>();

  public remember(records: readonly JournalRecord[], offset: number, length: number): void {
    for (const [recordIndex, record] of records.entries()) {
      const address = { offset, length, record: recordIndex };
      this.records.set(record.event.seq, address);
      if (record.event.type === 'run.finished' && record.event.runId !== null)
        this.baselines.delete(record.event.runId);
      if (record.event.type !== 'context.prepared') continue;
      const branch = record.event.data['branchId'];
      const raw = record.privateData?.['messages'];
      if (typeof branch !== 'string' || !Array.isArray(raw))
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'Request index requires a validated snapshot',
        );
      const runId = record.event.runId;
      if (runId === null)
        throw new StorageError('SESSION_LOG_INVALID', 'Conversation snapshot requires a Run');
      const branches = this.baselines.get(runId) ?? new Map<string, readonly MessageAddress[]>();
      const previous = branches.get(branch);
      const messages = raw.map((message, index): MessageAddress => {
        if (typeof message !== 'number') return { address, index };
        const source = previous?.[message];
        if (source === undefined)
          throw new StorageError(
            'SESSION_LOG_INVALID',
            'Request index message reference is invalid',
          );
        return source;
      });
      branches.set(branch, messages);
      this.baselines.set(runId, branches);
      this.snapshots.set(record.event.seq, { address, messages });
    }
  }

  public record(seq: number): JournalAddress | undefined {
    return this.records.get(seq);
  }
  public snapshot(seq: number): SnapshotAddress | undefined {
    return this.snapshots.get(seq);
  }
}
