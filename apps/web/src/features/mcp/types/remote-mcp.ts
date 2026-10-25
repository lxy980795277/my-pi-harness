import type { RemoteMcpInput, RemoteMcpTransport } from '@my-pi-harness/protocol';

export type RemoteMcpEditorMode = 'form' | 'json';
export type RemoteMcpHeaderKind = 'public' | 'secret';

/** Header bytes belong only to the mounted editor; configured slots contain no saved value. */
export interface RemoteMcpHeaderDraft {
  id: string;
  name: string;
  value: string;
  slotId: string;
  configured: boolean;
  kind: RemoteMcpHeaderKind;
}

/** The user-facing MCP ID maps to a configuration name, independently of its host UUID. */
export interface RemoteMcpDraft {
  mcpId: string;
  transport: RemoteMcpTransport;
  endpoint: string;
  headers: RemoteMcpHeaderDraft[];
  oauth: boolean;
  connectionId?: string;
  oauthClient?: RemoteMcpInput['oauthClient'];
}

export interface RemoteMcpSecretWrite {
  slotId: string;
  value: string;
}

/** Only input is public configuration; secrets must use the dedicated credential endpoint. */
export interface PreparedRemoteMcpDraft {
  input: RemoteMcpInput;
  secrets: RemoteMcpSecretWrite[];
}
