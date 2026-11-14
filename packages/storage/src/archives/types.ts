import type { Readable } from 'node:stream';
import type { SessionArchiveManifest } from '@my-pi-harness/protocol';
import type { FrozenSkill } from '@my-pi-harness/protocol/internal';

export interface SessionArchiveInput {
  manifest: SessionArchiveManifest;
  open(path: string): Readable;
}
export interface SessionArchiveEntry {
  path: string;
  bytes: number;
  sha256: string;
  open(): Readable;
}
export interface SessionArchiveSource {
  manifest: SessionArchiveManifest;
  entries: SessionArchiveEntry[];
  release(): void;
}
export interface SessionArchiveOptions {
  signal?: AbortSignal;
  resolveSkillDirectory?: (skill: FrozenSkill) => string;
}
export interface SessionArchiveImportsQuery {
  before?: { createdAt: number; operationId: string };
  limit?: number;
}
