import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/worker/tileBuild.worker.ts'),
      fileName: 'tileBuild.worker',
      formats: ['es'],
    },
    outDir: 'dist/worker',
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2023',
  },
});
