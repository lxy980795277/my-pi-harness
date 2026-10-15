import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@my-pi-harness/protocol': fileURLToPath(
        new URL('../protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 15_000, hookTimeout: 15_000 },
});
