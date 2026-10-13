import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@my-pi-harness/protocol': fileURLToPath(
        new URL('./packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: [
      'apps/daemon/test/**/*.test.ts',
      'apps/desktop/test/**/*.test.ts',
      'tests/unit/**/*.test.{ts,js}',
    ],
    exclude: ['apps/daemon/test/bootstrap.test.ts'],
    testTimeout: 10_000,
  },
});
