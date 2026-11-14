import { ToolError, type ToolInvocation, type ToolResult } from './tool-registry';

/** Tool semantics run under the host's write gate using a detached copy of the current bytes. */
export interface FileModification {
  path: string;
  expectedHash: string | null;
  prepare(before: Uint8Array | null): { content: Uint8Array; result: ToolResult };
}

/** Publication callbacks belong to the exact native tool ledger, never to model arguments. */
export interface FileChangeInvocation extends ToolInvocation {
  beforePublish(this: void, operationId: string): void;
  confirmNotPublished(this: void): void;
}

/** The host owns filesystem state, write ordering, durable images and mutation settlement. */
export interface FileChangeToolHandlers {
  modify(input: FileModification, invocation: FileChangeInvocation): Promise<ToolResult>;
}

/** File tools require the host's side-effect barrier even when called outside the normal catalog. */
export function fileChangeInvocation(invocation: ToolInvocation): FileChangeInvocation {
  const beforePublish = invocation.beforePublish;
  const confirmNotPublished = invocation.confirmNotPublished;
  if (!beforePublish || !confirmNotPublished)
    throw new ToolError('FILE_CHANGES_UNAVAILABLE', 'The file publication owner is unavailable');
  return { ...invocation, beforePublish, confirmNotPublished };
}
