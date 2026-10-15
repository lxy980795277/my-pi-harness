/** Model-facing tool content; image bytes stay out of public UI event projections. */
export type ExecutionContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** Bounded result returned after the owned operation has settled. */
export interface ExecutionResult {
  content: ExecutionContent[];
  summary: string;
  diff?: string;
}

/** The caller resolves the workspace and owns the cancellation signal. */
export interface ExecutionContext {
  workspaceRoot: string;
  profileDirectory: string;
  readOnly: boolean;
  signal: AbortSignal;
}

/** Authorization preview; creating it performs no filesystem or network work. */
export interface ToolDescription {
  summary: string;
  approvalRequired: boolean;
  mutating: boolean;
}
