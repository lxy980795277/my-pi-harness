import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@my-pi-harness/protocol': fileURLToPath(
        new URL('../protocol/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox/process': fileURLToPath(
        new URL('../sandbox/src/process/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox/network': fileURLToPath(
        new URL('../sandbox/src/network/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox': fileURLToPath(new URL('../sandbox/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 15000, maxWorkers: 4 },
});
