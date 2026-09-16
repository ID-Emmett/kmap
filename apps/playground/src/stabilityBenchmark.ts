import type { Map3D, ViewState } from '@kmap/map3d';

/** 双后端同场景测试：海面、虚线、字体、地球与连续运动帧独立留存。 */
export async function runStabilityBenchmark(map: Map3D, status: (text: string) => void): Promise<void> {
  const scenarios: { name: string; view: ViewState }[] = [
    { name: 'sea-report-1', view: { center: { lng: 121.22962, lat: 25.965288 }, zoom: 7.5, bearing: 305.8, pitch: 75 } },
    { name: 'sea-report-2', view: { center: { lng: 122.336626, lat: 24.858414 }, zoom: 9, bearing: 219.9, pitch: 61.1 } },
    { name: 'rail-labels', view: { center: { lng: 116.421, lat: 39.902 }, zoom: 16.5, bearing: 0, pitch: 45 } },
    { name: 'city-labels', view: { center: { lng: 116.394653, lat: 39.90552 }, zoom: 15.74, bearing: 30, pitch: 60 } },
    { name: 'borders', view: { center: { lng: 104, lat: 35 }, zoom: 7, bearing: 0, pitch: 0 } },
    { name: 'globe-transition', view: { center: { lng: 116, lat: 30 }, zoom: 5, bearing: 0, pitch: 0 } },
    { name: 'whole-earth', view: { center: { lng: 116, lat: 30 }, zoom: 0, bearing: 0, pitch: 0 } },
    { name: 'earth-dateline', view: { center: { lng: 179, lat: -20 }, zoom: 0, bearing: 45, pitch: 0 } },
  ];
  const started = performance.now(), results: unknown[] = [], errors: unknown[] = [], visualFrames: { image: string; atMs: number }[] = [];
  const stopError = map.on('error', error => errors.push(error));
  const recordMotion = new URLSearchParams(window.location.search).get('visual') === '1';
  const next = () => new Promise<void>(resolve => { const stop = map.observeFrames(() => { stop(); resolve(); }); });
  const capture = () => visualFrames.push({ image: document.querySelector<HTMLCanvasElement>('#map-canvas')!.toDataURL('image/jpeg', .92), atMs: performance.now() - started });
  try {
    for (const scenario of scenarios) {
      status(`稳定性验证：${scenario.name}`); map.setView(scenario.view);
      const begin = performance.now(); let settled = 0;
      while (performance.now() - begin < 25000 && settled < 90) {
        await next(); const d = map.getDiagnostics();
        const dataReady = d.globe.active ? d.globe.ready : d.tiles?.idle && d.tiles.uncoveredCells === 0 && d.tiles.targetMissing === 0;
        const textReady = scenario.name.includes('labels') ? (d.labels?.placed ?? 0) > 0 && d.labels?.pendingRanges === 0 : true;
        settled = dataReady && textReady ? settled + 1 : 0;
      }
      const diagnostics = map.getDiagnostics(); capture();
      const frames: ReturnType<Map3D['getFrameState']>[] = [], motionStart = performance.now(); let captured = 0;
      while (performance.now() - motionStart < 2400) {
        const t = (performance.now() - motionStart) / 2400;
        const scale = 360 / 2 ** scenario.view.zoom;
        map.setView({ ...scenario.view, center: { lng: scenario.view.center.lng + Math.sin(t * Math.PI * 2) * scale * .12, lat: scenario.view.center.lat },
          zoom: Math.max(0, scenario.view.zoom + Math.sin(t * Math.PI * 2) * .25), bearing: scenario.view.bearing + Math.sin(t * Math.PI * 2) * 8 });
        await next(); frames.push(map.getFrameState()); if (recordMotion && performance.now() - captured > 200) { capture(); captured = performance.now(); }
      }
      const samples = frames.map(frame => frame.ms).sort((a, b) => a - b), cpu = frames.map(frame => frame.cpuMs).sort((a, b) => a - b);
      const p95 = (values: number[]) => values[Math.floor(values.length * .95)] ?? 0;
      const uncoveredFrames = diagnostics.globe.active ? null : frames.filter(frame => frame.uncovered > 0).length;
      const passed = settled >= 90 && diagnostics.backend === map.getBackend() && diagnostics.globe.errors === 0
        && (uncoveredFrames ?? 0) === 0 && (diagnostics.labels?.glyphErrors ?? 0) === 0 && (diagnostics.tiles?.network.errors ?? 0) === 0;
      results.push({ name: scenario.name, passed, diagnostics, frames, motion: { frameP95: p95(samples), cpuP95: p95(cpu),
        uncoveredFrames } });
    }
    const passed = results.every(r => (r as { passed: boolean }).passed) && errors.length === 0;
    const report = { kind: 'map-stability', backend: map.getBackend(), input: 'programmatic-views', visualReview: 'pending', motionScreenshots: recordMotion,
      at: new Date().toISOString(), passed, results, errors, visualFrames };
    const response = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    if (!response.ok) throw new Error('稳定性证据保存失败');
    const saved = await response.json() as { file: string };
    document.documentElement.dataset.kmapStability = JSON.stringify({ passed, file: saved.file });
    status(`数据检查${passed ? '通过' : '存在失败项'}，画面待审查：${saved.file}`);
  } finally { stopError(); }
}
