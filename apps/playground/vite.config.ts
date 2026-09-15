import { defineConfig } from 'vite';
import { devEvidence } from './devEvidence.js';

export default defineConfig({
  plugins: [devEvidence()],
  build: {
    // Playground 固定包含 Three.js Inspector，开发包体阈值按该用途设置。
    chunkSizeWarningLimit: 1_100,
    target: 'esnext',
  },
  server: {
    host: '127.0.0.1',
    port: 6661,
  },
});
