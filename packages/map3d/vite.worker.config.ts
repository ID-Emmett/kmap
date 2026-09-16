import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: { 'paint.worker': resolve(import.meta.dirname, 'src/streaming/paint.worker.ts') },
      fileName: (_format, name) => `${name}.js`,
      formats: ['es'],
    },
    outDir: 'dist/worker',
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2023',
  },
});
