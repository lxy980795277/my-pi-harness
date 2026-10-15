import { defineConfig } from 'vitest/config';
import sourceConfig from './vitest.config.js';

export default defineConfig({
  ...sourceConfig,
  test: {
    include: ['test/bootstrap.test.ts', 'test/**/*.built.test.ts'],
    exclude: [],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
