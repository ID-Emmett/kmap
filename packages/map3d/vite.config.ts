import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      fileName: 'index',
      formats: ['es'],
    },
    rolldownOptions: {
      external: [/^three(?:\/.*)?$/],
    },
    sourcemap: true,
    target: 'es2023',
  },
});
