import { defineConfig, type Plugin } from 'vite';
import { devEvidence } from './devEvidence.js';

export default defineConfig({
  plugins: [devEvidence(), singleFileOutput()],
  build: {
    // Playground 固定包含 Inspector 与内联瓦片 Worker，单包阈值覆盖完整发布文件。
    chunkSizeWarningLimit: 1_400,
    target: 'esnext',
    rolldownOptions: {
      output: {
        codeSplitting: false,
        entryFileNames: 'playground.js',
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 6661,
  },
});

/** 保证发布目录只有固定名称的 HTML 与 JS。 */
function singleFileOutput(): Plugin {
  return {
    name: 'kmap-single-file-output',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];

      if (html?.type !== 'asset' || typeof html.source !== 'string') {
        throw new Error('Playground 构建缺少 index.html。');
      }

      const files = Object.keys(bundle).sort();
      const expected = ['index.html', 'playground.js'];
      if (files.length !== expected.length || files.some((file, index) => file !== expected[index])) {
        throw new Error(`Playground 构建产物必须为 ${expected.join('、')}，实际为 ${files.join('、')}。`);
      }
    },
  };
}
