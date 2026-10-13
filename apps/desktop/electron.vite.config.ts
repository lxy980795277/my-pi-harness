import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';

const protocol = fileURLToPath(new URL('../../packages/protocol/src/index.ts', import.meta.url));

export default defineConfig({
  main: {
    resolve: { alias: { '@my-pi-harness/protocol': protocol } },
    build: {
      outDir: 'dist/main',
      lib: {
        entry: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
        formats: ['es'],
      },
    },
  },
  preload: {
    resolve: { alias: { '@my-pi-harness/protocol': protocol } },
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url)),
        formats: ['cjs'],
        fileName: () => 'index.cjs',
      },
      externalizeDeps: { exclude: ['@my-pi-harness/protocol', 'typebox'] },
    },
  },
});
