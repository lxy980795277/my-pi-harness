import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      externalizeDeps: { exclude: ['@my-pi-harness/protocol', 'typebox'] },
      lib: {
        entry: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
        formats: ['es'],
      },
    },
  },
  preload: {
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
