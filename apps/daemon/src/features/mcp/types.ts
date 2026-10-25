import type { McpConnectionManager } from '@my-pi-harness/integrations';

/** Tests inject a protocol adapter, while production uses the official SDK manager. */
export type McpManager = Pick<
  McpConnectionManager,
  'previewLaunch' | 'discover' | 'acquire' | 'invalidateServer' | 'hasActiveLeases' | 'close'
>;
