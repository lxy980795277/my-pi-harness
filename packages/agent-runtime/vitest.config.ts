import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@my-pi-harness/sandbox/filesystem': fileURLToPath(
        new URL('../sandbox/src/filesystem/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox/network': fileURLToPath(
        new URL('../sandbox/src/network/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox/process': fileURLToPath(
        new URL('../sandbox/src/process/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox/policy': fileURLToPath(
        new URL('../sandbox/src/policy/index.ts', import.meta.url),
      ),
      '@my-pi-harness/sandbox': fileURLToPath(new URL('../sandbox/src/index.ts', import.meta.url)),
      '@my-pi-harness/tools/document-text': fileURLToPath(
        new URL('../tools/src/utils/document-text.ts', import.meta.url),
      ),
      '@my-pi-harness/tools/skills': fileURLToPath(
        new URL('../tools/src/skills/index.ts', import.meta.url),
      ),
      '@my-pi-harness/tools/plugins': fileURLToPath(
        new URL('../tools/src/plugins/index.ts', import.meta.url),
      ),
      '@my-pi-harness/tools': fileURLToPath(new URL('../tools/src/index.ts', import.meta.url)),

      '@my-pi-harness/protocol': fileURLToPath(
        new URL('../protocol/src/index.ts', import.meta.url),
      ),
      '@my-pi-harness/storage': fileURLToPath(new URL('../storage/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});
