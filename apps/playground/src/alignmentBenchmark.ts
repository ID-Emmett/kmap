import { Map3D, type ViewState } from '@kmap/map3d';

const nextFrame = (map: Map3D) => new Promise<void>(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
const phase = (value: string) => { document.documentElement.dataset.alignment = value; };
const settle = async (map: Map3D) => {
  const start = performance.now(); let steady = 0, since = performance.now();
  while (performance.now() - start < 30000 && (steady < 12 || performance.now() - since < 600)) {
    await nextFrame(map); const d = map.getDiagnostics();
    steady = d.tiles?.coverageComplete && !d.tiles.targetMissing && !d.labels?.pendingRanges ? steady + 1 : 0;
    if (!steady) since = performance.now();
  }
  return steady >= 12;
};
const save = async (value: object) => {
  const r = await fetch('/__kmap/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error('浏览器证据保存失败'); return r.json() as Promise<{ file: string }>;
};

/** 真实数据截图、运动覆盖及独立性能采样。 */
export async function runAlignmentBenchmark(map: Map3D): Promise<void> {
  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  const visualFrames: { name: string; atMs: number; image: string }[] = [], scenes: object[] = [], frames: object[] = [], errors: object[] = [];
  const off = map.on('error', e => errors.push({ code: e.code, message: e.message }));
  const views: [string, ViewState][] = [
    ['user-road', { center: { lng: 110.681651, lat: 26.050977 }, zoom: 19.89, bearing: 278.4, pitch: 26.7 }],
    ['user-land', { center: { lng: 117.347962, lat: 23.244634 }, zoom: 7.04, bearing: 3.4, pitch: 0 }],
    ['taiwan7', { center: { lng: 121, lat: 23.7 }, zoom: 7, bearing: 0, pitch: 0 }],
    ['taiwan10', { center: { lng: 121, lat: 23.7 }, zoom: 10, bearing: 0, pitch: 0 }],
    ['country', { center: { lng: 105, lat: 35 }, zoom: 2.7, bearing: 0, pitch: 0 }],
    ['province', { center: { lng: 112, lat: 35 }, zoom: 4.5, bearing: 0, pitch: 0 }],
    ['capital', { center: { lng: 112, lat: 35 }, zoom: 6, bearing: 0, pitch: 0 }],
    ['beijing', { center: { lng: 116.39465, lat: 39.9055 }, zoom: 15.8, bearing: 25, pitch: 55 }],
    ['beijing20', { center: { lng: 116.39465, lat: 39.9055 }, zoom: 20, bearing: 25, pitch: 65 }],
  ];
  try {
    for (const [name, view] of views) {
      phase(name); map.setView(view); const settled = await settle(map);
      scenes.push({ name, settled, diagnostics: map.getDiagnostics() });
      visualFrames.push({ name, atMs: performance.now(), image: canvas.toDataURL('image/jpeg', .94) });
    }
    const view = views.find(([name]) => name === 'beijing')![1]; map.setView(view); await settle(map); phase('motion');
    for (let n = 0; n < 360; n++) {
      map.setView({ ...view, zoom: 15.8 + Math.sin(n / 60) * .9, bearing: 25 + Math.sin(n / 95) * 25,
        center: { lng: view.center.lng + Math.sin(n / 80) * .012, lat: view.center.lat + Math.sin(n / 110) * .007 } });
      await nextFrame(map); frames.push(map.getFrameState());
      if (n % 60 === 0) visualFrames.push({ name: `motion${n}`, atMs: performance.now(), image: canvas.toDataURL('image/jpeg', .94) });
    }
    await settle(map); phase('performance');
    const perf: ReturnType<Map3D['getFrameState']>[] = [], start = performance.now();
    while (performance.now() - start < 12000) {
      const t = (performance.now() - start) / 1000;
      map.setView({ ...view, zoom: 15.8 + Math.sin(t) * .6,
        center: { lng: view.center.lng + Math.sin(t * .5) * .008, lat: view.center.lat + Math.cos(t * .4) * .005 } });
      await nextFrame(map); perf.push(map.getFrameState());
    }
    const p95 = (a: number[]) => a.sort((a, b) => a - b)[Math.floor(a.length * .95)];
    const result = await save({ kind: 'maplibre-alignment-real', backend: map.getBackend(), viewport: map.getDiagnostics().viewport,
      at: new Date().toISOString(), scenes, frames, errors, visualFrames, final: map.getDiagnostics(), performanceFrames: perf,
      performance: { frames: perf.length, fps: perf.length * 1000 / perf.reduce((sum, f) => sum + f.ms, 0),
        intervalP95: p95(perf.map(f => f.ms)), cpuP95: p95(perf.map(f => f.cpuMs)), uncoveredFrames: perf.filter(f => f.uncovered).length,
        maxCpuBytes: Math.max(...perf.map(f => f.cpuBytes)), maxGpuBytes: Math.max(...perf.map(f => f.gpuBytes)) } });
    phase(`done:${result.file}`);
  } catch (e) { phase(`error:${String(e)}`); throw e; } finally { off(); }
}

/** 标准 MVT v2：缓冲越过瓦片边缘的矩形，用模板逐采样点分配所有权。 */
function solidTile(): Uint8Array {
  const varint = (value: number): number[] => { const a = []; do { a.push(value > 127 ? value % 128 + 128 : value); value = Math.floor(value / 128); } while (value); return a; };
  const field = (tag: number, bytes: number[]) => [...varint(tag * 8 + 2), ...varint(bytes.length), ...bytes];
  const geometry = [9, 511, 511, 26, 9216, 0, 0, 9216, 9215, 0, 15].flatMap(varint);
  const feature = [8, 1, 24, 3, ...field(4, geometry)];
  const layer = [...field(1, [...new TextEncoder().encode('surface')]), ...field(2, feature), 40, ...varint(4096), 120, 2];
  return new Uint8Array(field(3, layer));
}

/** 延迟、空响应与反复跨级下，连续满色地表应覆盖全部已声明可用区域。 */
export async function runSeamBenchmark(current: Map3D): Promise<void> {
  const backend = current.getBackend(), viewport = current.getDiagnostics().viewport, originalFetch = window.fetch;
  current.stop(); await window.__kmapInspector?.resolveTimestamp();
  current.dispose();
  // WebGL dispose 会关闭原上下文；合成测试在独立画布创建新的渲染器。
  const canvas = document.createElement('canvas'); canvas.id = 'alignment-canvas';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh' }); document.body.append(canvas);
  const tile = solidTile(); let requests = 0;
  window.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith('/__alignment_tiles/')) return originalFetch(input, init);
    requests++;
    const [z, x, y] = url.split('/').slice(2).map(Number) as [number, number, number];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { init?.signal?.removeEventListener('abort', abort); resolve(); }, 30 + (x + y) % 5 * 35);
      const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
      if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort', abort, { once: true });
    });
    return z > 7 && (x + y) % 7 === 0 ? new Response(null, { status: 204 }) : new Response(tile.slice());
  };
  const map = new Map3D({ canvas, globe: false, renderer: { forceWebGL: backend === 'webgl2', backgroundColor: '#ff00ff' },
    source: { id: 'coverage-test', tiles: ['/__alignment_tiles/{z}/{x}/{y}'], minZoom: 0, maxZoom: 17 },
    layers: [{ type: 'fill', id: 'solid', sourceLayer: 'surface', paint: { color: '#185e96' } }],
    view: { center: { lng: 116.39, lat: 39.9 }, zoom: 10, pitch: 0, bearing: 0 } });
  window.__kmapMap3D = map; map.resize(viewport);
  const read = document.createElement('canvas'); read.width = canvas.width; read.height = canvas.height;
  const ctx = read.getContext('2d', { willReadFrequently: true })!;
  const frames: object[] = [], anomalies: object[] = [], errors: object[] = [], visualFrames: { name: string; atMs: number; image: string }[] = [];
  const off = map.on('error', e => errors.push({ code: e.code, message: e.message }));
  try {
    phase('seam-initialize'); await map.initialize(); await settle(map);
    for (let n = 0; n < 720; n++) {
      phase(`seam-${n}`);
      map.setView({ center: { lng: 116.39 + Math.sin(n / 70) * .45, lat: 39.9 + Math.sin(n / 100) * .25 },
        zoom: 10.1 + Math.sin(n / 120) * 1.6, pitch: 20 + 20 * Math.sin(n / 130), bearing: n / 8 });
      await nextFrame(map);
      const f = map.getFrameState(); ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, read.width, read.height).data; let holes = 0, samples = 0;
      // 中央视野远离雾端与画布边缘；全分辨率扫描包含单像素缝。
      for (let y = Math.floor(read.height * .3); y < read.height * .85; y++) for (let x = Math.floor(read.width * .15); x < read.width * .85; x++) {
        const i = (y * read.width + x) * 4; samples++;
        if (data[i]! > 80 && data[i]! > data[i + 1]! * 1.5 && data[i + 2]! > 130) holes++;
      }
      frames.push({ ...f, holes, samples });
      if (!f.uncovered && holes) {
        anomalies.push({ frame: n, holes, f });
        if (visualFrames.length < 12) visualFrames.push({ name: `hole-${n}`, atMs: performance.now(), image: canvas.toDataURL('image/jpeg', .96) });
      }
    }
    const settled = await settle(map);
    const result = await save({ kind: 'maplibre-alignment-seams', at: new Date().toISOString(), backend, viewport, requests, settled,
      frames, anomalies, errors, visualFrames, diagnostics: map.getDiagnostics(), screenshot: canvas.toDataURL() });
    phase(`done:${result.file}`);
  } catch (e) { phase(`error:${String(e)}`); throw e; }
  finally { off(); window.fetch = originalFetch; }
}
