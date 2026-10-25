/** Model-facing tool content; image bytes stay out of public UI event projections. */
export type ExecutionContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export type ShellAccess = 'sandboxed' | 'full-access';
export type WorkspacePathPlatform = 'posix' | 'win32';
export type FileMutationToolName = 'write_file' | 'edit_file';

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
  /** Frozen by the run owner; omission keeps macOS Seatbelt isolation. */
  shellAccess?: ShellAccess;
  officePythonPath?: string;
  signal: AbortSignal;
}

/** Authorization preview; creating it performs no filesystem or network work. */
export interface ToolDescription {
  summary: string;
  approvalRequired: boolean;
  mutating: boolean;
}
