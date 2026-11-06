import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@my-pi-harness/sandbox/filesystem': fileURLToPath(
        new URL('./packages/sandbox/src/filesystem/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox/network': fileURLToPath(
        new URL('./packages/sandbox/src/network/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox/process': fileURLToPath(
        new URL('./packages/sandbox/src/process/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox/policy': fileURLToPath(
        new URL('./packages/sandbox/src/policy/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox': fileURLToPath(
        new URL('./packages/sandbox/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/tools/document-text': fileURLToPath(
        new URL('./packages/tools/src/utils/document-text.ts', import.meta.url),
      ),
      '@my-pi-harness/tools/skills': fileURLToPath(
        new URL('./packages/tools/src/skills/index.ts', import.meta.url),
      ),
      '@my-pi-harness/tools/plugins': fileURLToPath(
        new URL('./packages/tools/src/plugins/index.ts', import.meta.url),
      ),
      '@my-pi-harness/tools': fileURLToPath(
        new URL('./packages/tools/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/integrations': fileURLToPath(
        new URL('./packages/integrations/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),

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
      'packages/tools/test/**/*.test.ts',
      'packages/sandbox/test/**/*.test.ts',
      'packages/integrations/test/**/*.test.ts',
      'packages/agent-runtime/test/**/*.test.ts',
      'apps/desktop/test/**/*.test.ts',
      'tests/unit/**/*.test.{ts,js}',
    ],
    exclude: ['apps/daemon/test/bootstrap.test.ts', 'apps/daemon/test/**/*.built.test.ts'],
    testTimeout: 10_000,
  },
});
