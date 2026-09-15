import type { Map3D } from '@nova/map3d';
import { runBrowserBenchmark } from './browserBenchmark.js';
import { CITIES, flyToCity } from './cityFlight.js';
import { captureGestures } from './gestureCapture.js';

type Diagnostics = ReturnType<Map3D['getDiagnostics']>;
const ms = (n = 0): string => `${n.toFixed(2)} ms`;
const mib = (n = 0): string => `${(n / 1048576).toFixed(1)} MiB`;
const count = (n = 0): string => n.toLocaleString('en-US');

/** 以 4Hz 更新的性能面板；每个数值单独更新，保持控件焦点与滚动位置。 */
export function createDiagnosticsPanel(map: Map3D): () => void {
  const panel = document.createElement('aside');
  panel.className = 'diagnostics';
  panel.setAttribute('aria-label', '地图性能面板');
  panel.innerHTML = `<header><div><span class="eyebrow">NOVA / TILE OBSERVATORY</span><h1>地图性能</h1></div><button id="panel-toggle" aria-expanded="true">收起</button></header>
    <div class="panel-body"><div class="vitals"><div><strong data-metric="fps">—</strong><span>FPS · 实际帧间隔</span></div><div><strong data-metric="backend">—</strong><span data-metric="phase">初始化</span></div></div>
    <canvas id="frame-chart" width="320" height="44" aria-label="最近 30 秒 CPU 帧耗时趋势"></canvas>
    <section><h2>帧与渲染</h2><dl id="frame-metrics"></dl></section>
    <section><h2>瓦片与加载</h2><dl id="tile-metrics"></dl></section>
    <section><h2>缓存与资源</h2><dl id="cache-metrics"></dl></section>
    <section><h2>相机与覆盖</h2><dl id="camera-metrics"></dl></section>
    <section><h2>复现与采样</h2><div class="controls"><button data-view="home">初始视图</button><button data-view="out">缩小一级</button><button data-view="in">放大一级</button><button data-view="rotate">旋转 45°</button>${[0, 20, 40, 60].map((pitch) => `<button data-pitch="${pitch}">倾角 ${pitch}°</button>`).join('')}</div>
    <div class="controls"><button id="city-flight">城市飞行：北京 → 上海 → 北京</button><button id="fly-guangzhou">飞往广州</button><button id="gesture-capture">记录手势 30 秒</button></div>
    <div class="controls"><button id="benchmark">运行 60 秒验收</button><button id="transition-capture">首屏与快速交互验收</button><button id="export">导出诊断 JSON</button></div><p id="benchmark-status" role="status">拖动平移 · 滚轮缩放 · 右键拖动旋转和倾斜</p></section>
    <footer>CPU 帧耗时为主线程工作时间；FPS 来自实际帧间隔。缓存命中统计瓦片进入可见集或请求集合时的就绪数据复用；内存数值为瓦片估算与渲染器登记值。</footer></div>`;
  document.body.append(panel);
  const fields = new Map<string, HTMLElement>();
  const rows: Record<string, readonly [string, string][]> = {
    frame: [['cpu', 'CPU 帧 / P95'], ['interval', '帧间隔 P95 / 输入 P95'], ['draws', 'Draw calls / 三角形'], ['phases', '选择 / 提交 / 回收 P95'], ['worker', 'Worker P95 / 上传 P95'], ['workerJobs', 'Worker 活动 / 等待']],
    tile: [['cover', '目标 / 已显示 / 过渡'], ['missing', '目标待就绪 / 覆盖缺口'], ['queue', '请求排队 / 活动'], ['requests', '累计请求 / 取消排队'], ['requestTime', '请求链路 P95 / HTTP P95'], ['network', 'HTTP 次数 / 重试 / 取消'], ['networkBytes', 'MVT 解压字节 / 错误'], ['upload', '上传排队 / 活动'], ['empty', '空瓦片 / 失败'], ['levels', '目标层级 : 数量']],
    cache: [['cache', '驻留 / 预热 / 冷缓存'], ['hits', '命中 / 未命中 / 命中率'], ['entries', '条目 / 上限 / 淘汰'], ['cpuMemory', 'CPU 缓存 / 预算'], ['gpuMemory', 'GPU 瓦片 / 预算'], ['registry', '资源 / 引用 / 释放'], ['scene', '场景瓦片 / 对象'], ['geometry', '几何 / 纹理 / 渲染器内存'], ['pressure', '预算压力']],
    camera: [['center', '经度 / 纬度'], ['view', 'Zoom / Bearing / Pitch'], ['position', '相机 XYZ（相对原点·米）'], ['origin', '原点 Mercator XY（米）'], ['viewport', '视口 / DPR'], ['cutoff', '加载半径 / 邻接层级差']],
  };
  for (const [group, definitions] of Object.entries(rows)) {
    const dl = panel.querySelector(`#${group}-metrics`)!;
    for (const [key, label] of definitions) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.dataset.metric = key; dd.textContent = '—';
      dl.append(dt, dd); fields.set(key, dd);
    }
  }
  for (const element of panel.querySelectorAll<HTMLElement>('[data-metric]')) fields.set(element.dataset.metric!, element);
  const set = (key: string, value: string): void => { const field = fields.get(key); if (field !== undefined && field.textContent !== value) field.textContent = value; };
  const home = map.getView();
  const history: number[] = [];
  const chart = panel.querySelector<HTMLCanvasElement>('#frame-chart')!.getContext('2d')!;
  let latest: Diagnostics | undefined;
  let running = false;
  let stopped = false;
  const status = panel.querySelector<HTMLElement>('#benchmark-status')!;
  const timer = setInterval(() => {
    latest = map.getDiagnostics();
    const d = latest; const t = d.tiles; const cache = t?.cache; const r = t?.resources;
    const stats = map.getStats();
    set('fps', d.frame.fps.toFixed(0)); set('backend', d.backend.toUpperCase()); set('phase', t?.idle ? '空闲 · 队列收敛' : t?.phase ?? '初始化');
    set('cpu', `${ms(d.frame.cpu.last)} / ${ms(d.frame.cpu.p95)}`);
    set('interval', `${ms(d.frame.interval.p95)} / ${ms(d.frame.input.p95)}`);
    set('draws', `${count(d.render.drawCalls)} / ${count(d.render.triangles)}`);
    set('phases', `${ms(t?.phases.plan?.p95)} / ${ms(t?.phases.cover?.p95)} / ${ms(t?.phases.resources?.p95)}`);
    set('worker', `${ms(t?.worker.p95)} / ${ms(t?.uploadTime.p95)}`);
    set('workerJobs', `${d.workers?.active ?? 0} / ${d.workers?.queued ?? 0}`);
    set('cover', `${t?.target ?? 0} / ${t?.committed ?? 0} / ${t?.outgoing ?? 0}`);
    set('missing', `${t?.targetMissing ?? 0} / ${t?.uncoveredCells ?? 0}`);
    set('queue', `${t?.scheduler?.queued ?? 0} / ${t?.scheduler?.active ?? 0}`);
    set('requests', `${t?.scheduler?.requestStarts ?? 0} / ${t?.scheduler?.requestCancels ?? 0}`);
    set('requestTime', `${ms(t?.requestTime.p95)} / ${ms(t?.network?.latency.p95)}`);
    set('network', `${t?.network?.starts ?? 0} / ${t?.network?.retries ?? 0} / ${t?.network?.cancels ?? 0}`);
    set('networkBytes', `${mib(t?.network?.bytes)} / ${t?.network?.errors ?? 0}`);
    set('upload', `${t?.upload?.queued ?? 0} / ${t?.upload?.active ?? 0}`);
    set('empty', `${stats.tiles.empty} / ${stats.tiles.failed}`);
    set('levels', Object.entries(t?.levels ?? {}).map(([z, n]) => `z${z}: ${n}`).join(' · '));
    set('cache', `${cache?.resident ?? 0} / ${cache?.warm ?? 0} / ${cache?.cold ?? 0}`);
    set('hits', `${t?.cacheHits ?? 0} / ${t?.cacheMisses ?? 0} / ${((t?.cacheHitRate ?? 0) * 100).toFixed(1)}%`);
    set('entries', `${cache?.entries ?? 0} / ${cache?.maxEntries ?? 256} / ${cache?.evictions ?? 0}`);
    set('cpuMemory', `${mib(cache?.cpuBytes)} / ${mib(cache?.maxCpuBytes)}`);
    set('gpuMemory', `${mib(r?.gpuBytes)} / ${mib(r?.maxGpuBytes)}`);
    set('registry', `${r?.entries ?? 0} / ${r?.referencedEntries ?? 0} / ${r?.releases ?? 0}`);
    set('scene', `${d.sceneTiles} / ${stats.resources.objects}`);
    set('geometry', `${d.memory.geometries ?? 0} / ${d.memory.textures ?? 0} / ${mib(d.memory.total)}`);
    set('pressure', [...(cache?.pressureReasons ?? []), ...(r?.pressureReasons ?? [])].join(' · ') || '正常');
    set('center', `${d.view.center.lng.toFixed(6)} / ${d.view.center.lat.toFixed(6)}`);
    set('view', `${d.view.zoom.toFixed(2)} / ${d.view.bearing.toFixed(1)}° / ${d.view.pitch.toFixed(1)}°`);
    set('position', Object.values(d.camera.position).map((n) => n.toFixed(1)).join(' / '));
    set('origin', `${d.camera.origin.meters.x.toFixed(1)} / ${d.camera.origin.meters.y.toFixed(1)}`);
    set('viewport', `${d.viewport.width} × ${d.viewport.height} / ${d.viewport.pixelRatio}`);
    set('cutoff', `${(t?.footprint?.loadCutoff ?? 0).toFixed(0)} m / ${t?.maxLodDelta ?? 0}`);
    document.documentElement.dataset.novaDiagnostics = JSON.stringify(d, (key, value: unknown) => key === 'values' ? undefined : value);
    history.push(d.frame.cpu.p95); if (history.length > 120) history.shift();
    chart.clearRect(0, 0, 320, 44); chart.strokeStyle = '#d8e2dc'; chart.beginPath(); chart.moveTo(0, 22); chart.lineTo(320, 22); chart.stroke();
    chart.strokeStyle = '#1a866b'; chart.lineWidth = 1.5; chart.beginPath(); history.forEach((v, i) => { const x = i / 119 * 320; const y = 42 - Math.min(40, v); if (i === 0) chart.moveTo(x, y); else chart.lineTo(x, y); }); chart.stroke();
  }, 250);
  panel.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button'); if (button === null) return;
    if (button.id === 'panel-toggle') { const hidden = panel.classList.toggle('collapsed'); button.textContent = hidden ? '展开' : '收起'; button.setAttribute('aria-expanded', String(!hidden)); return; }
    if (button.id === 'export') {
      requestAnimationFrame(() => {
        const value = { screenshot: document.querySelector<HTMLCanvasElement>('#map-canvas')?.toDataURL('image/png'), at: new Date().toISOString(), diagnostics: latest, timeline: map.getTileTimeline(), benchmark: document.documentElement.dataset.novaBenchmark ? JSON.parse(document.documentElement.dataset.novaBenchmark) : undefined };
        if (import.meta.env.DEV) {
          void fetch('/__nova/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }).then(async (response) => {
            if (!response.ok) throw new Error('诊断保存失败');
            const saved = await response.json() as { file: string };
            status.textContent = `已保存：${saved.file}`;
          }).catch(() => { download(value); status.textContent = '诊断 JSON 已下载'; });
        } else download(value);
      });
      return;
    }
    if (running) return;
    if (button.id === 'gesture-capture') {
      button.disabled = true;
      void captureGestures(map, text => { status.textContent = text; }).catch(error => { status.textContent = String(error); }).finally(() => { button.disabled = false; });
      return;
    }
    if (button.id === 'city-flight' || button.id === 'fly-guangzhou') {
      running = true; button.disabled = true;
      const flight = async () => {
        if (button.id === 'city-flight') {
          status.textContent = '城市飞行：北京 → 上海';
          await flyToCity(map, CITIES.beijing, 3000, () => stopped);
          await flyToCity(map, CITIES.shanghai, 12000, () => stopped);
          status.textContent = '城市飞行：上海 → 北京';
          await flyToCity(map, CITIES.beijing, 12000, () => stopped);
        } else { status.textContent = '城市飞行：广州'; await flyToCity(map, CITIES.guangzhou, 10000, () => stopped); }
        status.textContent = '城市飞行完成';
      };
      void flight().catch(error => { status.textContent = String(error); }).finally(() => { running = false; button.disabled = false; });
      return;
    }
    const view = map.getView();
    if (button.id === 'transition-capture') { window.location.assign('/?capture=transitions'); return; }
    if (button.dataset.pitch !== undefined) map.setView({ pitch: Number(button.dataset.pitch) });
    if (button.dataset.view === 'home') map.setView(home);
    if (button.dataset.view === 'in') map.setView({ zoom: view.zoom + 1 });
    if (button.dataset.view === 'out') map.setView({ zoom: view.zoom - 1 });
    if (button.dataset.view === 'rotate') map.setView({ bearing: view.bearing + 45 });
    if (button.id === 'benchmark') {
      running = true; button.disabled = true;
      void runBrowserBenchmark(map, (message) => { status.textContent = message; }, () => stopped).then((result) => {
        document.documentElement.dataset.novaBenchmark = JSON.stringify(result);
        status.textContent = result.passed ? '60 秒采样完成 · 功能断言通过' : '采样完成 · 详细结果见导出 JSON';
      }).catch((error: unknown) => { status.textContent = String(error); }).finally(() => { running = false; button.disabled = false; });
    }
  });
  return () => { stopped = true; clearInterval(timer); panel.remove(); };
}

function download(value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `nova-webgpu-${Date.now()}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
