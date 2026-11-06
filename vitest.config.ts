import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
  test: {
    // Typed ESLint creates several compiler programs; bound concurrent worker memory and CPU.
    maxWorkers: 4,
    include: [
      'apps/daemon/test/**/*.test.ts',
      'apps/web/test/**/*.test.ts',
      'packages/storage/test/**/*.test.ts',
      'packages/tools/test/**/*.test.ts',
      'packages/plugins/test/**/*.test.ts',
      'packages/sandbox/test/**/*.test.ts',
      'packages/integrations/test/**/*.test.ts',
      'packages/agent-runtime/test/**/*.test.ts',
      'apps/desktop/test/**/*.test.ts',
      'tests/unit/**/*.test.{ts,js}',
    ],
    exclude: ['apps/daemon/test/bootstrap.test.ts', 'apps/daemon/test/**/*.deployment.test.ts'],
    testTimeout: 10_000,
  },
});
