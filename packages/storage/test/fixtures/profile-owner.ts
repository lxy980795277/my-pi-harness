import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { openProfileStore } from '../../src/index.js';

const directory = process.argv[2];
if (directory === undefined) throw new Error('Profile directory is required');
const StopSchema = Type.Object({ type: Type.Literal('stop') }, { additionalProperties: false });

try {
  const store = await openProfileStore(directory);
  if (process.argv[3] === 'running') {
    store.createSession({
      id: 'crash-session',
      branchId: 'main',
      title: 'Crash fixture',
      providerId: 'fixture',
      modelId: 'fixture',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: 1,
    });
    store.append('crash-session', [
      {
        type: 'run.accepted',
        runId: 'crash-run',
        at: 2,
        data: {
          requestId: 'crash-request',
          run: {
            id: 'crash-run',
            sessionId: 'crash-session',
            branchId: 'main',
            providerId: 'fixture',
            modelId: 'fixture',
            status: 'running',
            createdAt: 2,
            finishedAt: null,
            error: null,
          },
        },
      },
      {
        type: 'message.started',
        runId: 'crash-run',
        at: 2,
        data: {
          id: 'partial',
          sessionId: 'crash-session',
          branchId: 'main',
          runId: 'crash-run',
          role: 'assistant',
          text: 'Committed before kill',
          thinking: '',
          createdAt: 2,
          status: 'streaming',
          stopReason: null,
        },
      },
    ]);
  }
  process.on('message', (message: unknown) => {
    if (!Value.Check(StopSchema, message)) return;
    store.close();
    if (process.connected) process.disconnect();
  });
  process.once('disconnect', () => store.close());
  process.send?.({ status: 'ready' });
} catch (error: unknown) {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'UNKNOWN';
  process.send?.({ status: 'error', code }, () => {
    if (process.connected) process.disconnect();
  });
}
