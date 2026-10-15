import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
      '@my-pi-harness/execution': fileURLToPath(
        new URL('./packages/execution/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/storage': fileURLToPath(
        new URL('./packages/storage/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/agent-runtime': fileURLToPath(
        new URL('./packages/agent-runtime/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/protocol': fileURLToPath(
        new URL('./packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    // Typed ESLint creates several compiler programs; bound concurrent worker memory and CPU.
    maxWorkers: 4,
    include: [
      'apps/daemon/test/**/*.test.ts',
      'apps/web/test/**/*.test.ts',
      'packages/storage/test/**/*.test.ts',
      'packages/execution/test/**/*.test.ts',
      'packages/agent-runtime/test/**/*.test.ts',
      'apps/desktop/test/**/*.test.ts',
      'tests/unit/**/*.test.{ts,js}',
    ],
    exclude: ['apps/daemon/test/bootstrap.test.ts', 'apps/daemon/test/**/*.built.test.ts'],
    testTimeout: 10_000,
  },
});
