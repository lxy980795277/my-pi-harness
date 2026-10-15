import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@my-pi-harness/execution': fileURLToPath(
        new URL('../execution/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/protocol': fileURLToPath(
        new URL('../protocol/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/storage': fileURLToPath(new URL('../storage/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});
