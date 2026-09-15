import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** 本机开发服务器将面板导出的诊断保存到任务证据目录。 */
export function devEvidence(): Plugin {
  const directory = fileURLToPath(new URL('../../docs/evidence/', import.meta.url));
  return {
    name: 'nova-local-evidence',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__nova/video', async (request, response) => {
        if (request.method !== 'POST' || request.headers.origin !== `http://${request.headers.host}`) { response.writeHead(403).end(); return; }
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 128 * 1024 * 1024) { response.writeHead(413).end(); return; } chunks.push(Buffer.from(chunk)); }
        const stem = `streaming-rebuild/video-${Date.now()}.webm`;
        await mkdir(`${directory}/streaming-rebuild`, { recursive: true });
        await writeFile(`${directory}/${stem}`, Buffer.concat(chunks));
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ file: `docs/evidence/${stem}` }));
      });
      server.middlewares.use('/__nova/diagnostics', async (request, response) => {
        if (request.method !== 'POST' || request.headers.origin !== `http://${request.headers.host}`) {
          response.writeHead(403).end(); return;
        }
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 64 * 1024 * 1024) { response.writeHead(413).end(); return; }
            chunks.push(Buffer.from(chunk));
          }
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const stem = `streaming-rebuild/webgpu-${new Date().toISOString().replace(/[:.]/g, '-')}`;
          await mkdir(`${directory}/streaming-rebuild`, { recursive: true });
          if (Array.isArray(data.visualFrames)) {
            const frames = data.visualFrames as { image: string; atMs: number }[];
            await mkdir(`${directory}/${stem}-frames`, { recursive: true });
            for (let i = 0; i < frames.length; i++) {
              const frame = frames[i]!;
              if (typeof frame.image === 'string' && frame.image.startsWith('data:image/jpeg;base64,')) {
                const file = `${stem}-frames/${String(i).padStart(4, '0')}.jpg`;
                await writeFile(`${directory}/${file}`, Buffer.from(frame.image.slice(23), 'base64')); frame.image = file;
              }
            }
          }
          if (typeof data.screenshot === 'string' && data.screenshot.startsWith('data:image/png;base64,')) {
            await writeFile(`${directory}/${stem}.png`, Buffer.from(data.screenshot.slice(22), 'base64'));
            data.screenshot = `${stem}.png`;
          }
          await writeFile(`${directory}/${stem}.json`, JSON.stringify(data, null, 2), 'utf8');
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ file: `docs/evidence/${stem}.json` }));
        } catch {
          response.writeHead(400).end('诊断保存失败');
        }
      });
    },
  };
}
