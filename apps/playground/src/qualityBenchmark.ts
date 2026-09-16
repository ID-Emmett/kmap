import type { Map3D, ViewState } from '@kmap/map3d';

/** 在实际生产页面顺序验证阈值、倾角、城市建筑、边界与缩放，并保存帧和诊断。 */
export async function runQualityBenchmark(map: Map3D, status: (text: string) => void): Promise<void> {
  const home = map.getView();
  const beijing = { lng: 116.3946533203125, lat: 39.90552253972854 };
  const scenarios: { name: string; view: Partial<ViewState> }[] = [
    { name: 'z15-hidden', view: { center: beijing, zoom: 15, pitch: 45, bearing: 0 } },
    { name: 'z15.739-hidden', view: { zoom: 15.739 } },
    { name: 'z15.74-visible', view: { zoom: 15.74 } },
    { name: 'z16-buildings', view: { zoom: 16, pitch: 60 } },
    { name: 'z16-pitch75', view: { pitch: 75 } },
    { name: 'z16-pitch75-bearing135', view: { bearing: 135 } },
    { name: 'z17-buildings', view: { center: { lng: 121.499, lat: 31.236 }, zoom: 17, pitch: 60, bearing: 30 } },
    { name: 'z18-overzoom', view: { zoom: 18 } },
    { name: 'z14-roads', view: { center: beijing, zoom: 14, pitch: 0, bearing: 0 } },
    { name: 'z16-roads', view: { zoom: 16 } },
    { name: 'z18-roads', view: { zoom: 18 } },
    { name: 'z5-country', view: { center: { lng: 104, lat: 35 }, zoom: 5, pitch: 0 } },
    { name: 'z7-provinces', view: { zoom: 7 } },
    { name: 'z9-pitch75', view: { zoom: 9, pitch: 75 } },
    { name: 'return-home', view: home },
  ];
  const results: unknown[] = [], frames: { image: string; atMs: number }[] = [], errors: unknown[] = [];
  const stop = map.on('error', error => errors.push(error));
  const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const started = performance.now();
  try {
    for (const scenario of scenarios) {
      status(`画质验证：${scenario.name}`); map.setView(scenario.view);
      const begin = performance.now(); let settled = 0;
      while (performance.now() - begin < 20000 && settled < 240) {
        await nextFrame(); const d = map.getDiagnostics();
        settled = d.tiles?.targetMissing === 0 && d.tiles.uncoveredCells === 0 && d.tiles.idle ? settled + 1 : 0;
      }
      const d = map.getDiagnostics(); const buildings = d.tiles?.buildings.batches ?? 0;
      const passed = d.backend === 'webgpu' && d.tiles?.uncoveredCells === 0 && d.tiles.targetMissing === 0 && d.tiles.maxLodDelta === 0
        && d.tiles.network.errors === 0 && d.tiles.cache.cpuBytes <= d.tiles.cache.maxCpuBytes && d.tiles.resources.gpuBytes <= d.tiles.resources.maxGpuBytes
        && (d.view.zoom < 15.74 ? buildings === 0 : buildings > 0);
      results.push({ name: scenario.name, passed, settleMs: performance.now() - begin, diagnostics: d });
      frames.push({ image: document.querySelector<HTMLCanvasElement>('#map-canvas')!.toDataURL('image/jpeg', .92), atMs: performance.now() - started });
    }
    const passed = results.every(r => (r as { passed: boolean }).passed) && errors.length === 0;
    const report = { kind: 'map-quality', at: new Date().toISOString(), passed, results, errors, visualFrames: frames };
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    if (!response.ok) throw new Error('画质证据保存失败');
    const saved = await response.json() as { file: string };
    document.documentElement.dataset.kmapQuality = JSON.stringify({ passed, file: saved.file, results: results.map(r => ({ name: (r as { name: string }).name, passed: (r as { passed: boolean }).passed })) });
    status(`画质验证${passed ? '通过' : '存在失败项'}：${saved.file}`);
  } finally { stop(); }
}
