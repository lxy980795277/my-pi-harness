import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@my-pi-harness/integrations': fileURLToPath(
        new URL('../../packages/integrations/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/execution': fileURLToPath(
        new URL('../../packages/execution/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/storage': fileURLToPath(
        new URL('../../packages/storage/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/agent-runtime': fileURLToPath(
        new URL('../../packages/agent-runtime/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/protocol': fileURLToPath(
        new URL('../../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/bootstrap.test.ts', 'test/**/*.built.test.ts'],
  },
});
