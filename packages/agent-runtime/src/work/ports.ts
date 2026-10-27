import type {
  AttachmentContent,
  Checkpoint,
  Compaction,
  SessionSnapshot,
  WorkState,
  Workspace,
} from '@my-pi-harness/protocol';
import type { RuntimeStore, EventInput } from '../sessions/ports.js';
import type { ModelGateway } from '../models/gateway.js';

/** Host storage adds branch-local work and private attachment bytes to the existing event store. */
export interface WorkStore extends RuntimeStore {
  getWorkState(sessionId: string, branchId?: string): WorkState;
  listCheckpoints(sessionId: string): Checkpoint[];
  listCompactions(sessionId: string, branchId?: string): Compaction[];
  getAttachment(id: string): AttachmentContent | undefined;
}

/** SessionRuntime retains command serialization and publication ownership. */
export interface WorkRuntimeOptions {
  store: WorkStore;
  gateway: Pick<ModelGateway, 'resolve'>;
  profileDirectory: string;
  resolveWorkspace(id: string): Promise<Workspace>;
  command<T>(
    sessionId: string,
    operation: (snapshot: SessionSnapshot) => T | Promise<T>,
    allowActive?: boolean,
  ): Promise<T>;
  commit(sessionId: string, events: readonly EventInput[]): void;
}
