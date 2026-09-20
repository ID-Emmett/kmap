import type { Map3D } from '@kmap/map3d';
import type { PerspectiveCamera, Scene } from 'three/webgpu';

/** 固定台湾视图在限速冷加载期间逐帧检测海面回白与重复绘制差异。 */
export async function runColdContinuityBenchmark(map: Map3D): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
  const runtime = map as unknown as { scene: Scene; camera: PerspectiveCamera };
  const sample = new OffscreenCanvas(160, 90), ctx = sample.getContext('2d', { willReadFrequently: true })!;
  const read = () => { ctx.drawImage(canvas, 0, 0, 160, 90); return ctx.getImageData(0, 0, 160, 90).data; };
  const frames: unknown[] = [], errors: unknown[] = [];
  const ocean = [110, 125, 140].flatMap(x => [40, 55, 70].map(y => (y * 160 + x) * 4));
  const seen = new Set<number>(); let reversions = 0, maxChanged = 0, completed = false;
  const start = performance.now(), offError = map.on('error', e => errors.push(e.message));
  map.setView({ center: { lng: 121, lat: 23.7 }, zoom: 7, pitch: 0, bearing: 0 });
  document.documentElement.dataset.coldContinuity = 'running';
  await new Promise<void>(resolve => {
    const off = map.observeFrames(() => {
      const first = read(); map.getRenderer().render(runtime.scene, runtime.camera); const second = read();
      let changed = 0;
      for (let i = 0; i < first.length; i += 4) if (Math.max(Math.abs(first[i]! - second[i]!), Math.abs(first[i + 1]! - second[i + 1]!), Math.abs(first[i + 2]! - second[i + 2]!)) > 16) changed++;
      maxChanged = Math.max(maxChanged, changed);
      for (const index of ocean) {
        // 水色需同时满足青蓝色差；初始化背景 #dbdeff 的紫蓝色差为 36。
        const blue = first[index + 2]! - first[index]! > 50 && first[index + 1]! - first[index]! > 20;
        if (blue) seen.add(index);
        else if (seen.has(index) && first[index]! > 220) reversions++;
      }
      const frame = map.getFrameState(); frames.push({ ...frame, changed, oceanVisible: seen.size,
        oceanColors: ocean.map(i => [first[i], first[i + 1], first[i + 2]]) });
      if (performance.now() - start > 45000 || frames.length > 60 && frame.missing === 0 && frame.uncovered === 0 && seen.size === ocean.length) {
        completed = frame.missing === 0 && frame.uncovered === 0; off(); resolve();
      }
    });
  });
  offError();
  const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    kind: 'cold-continuity', backend: map.getBackend(), at: new Date().toISOString(), viewport: map.getDiagnostics().viewport,
    network: { latencyMs: 150, downloadBytesPerSecond: 500000, browserCache: false }, completed,
    reversions, maxChanged, oceanSamples: ocean.length, seen: seen.size, frames, errors, diagnostics: map.getDiagnostics(), screenshot: canvas.toDataURL('image/png'),
  }) });
  document.documentElement.dataset.coldContinuity = `done:${(await response.json() as { file: string }).file}`;
}
