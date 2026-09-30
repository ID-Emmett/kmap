/**
 * T051 前台 Chrome 探针：固定俯仰角矩阵、连续俯仰/平移/缩放、主题编辑与重置、底图切换，
 * 保存前台激活状态、截图、逐帧天空边界、垂直颜色剖面与诊断 JSON。
 *
 * 用法：node scripts/T051-browser-probe.mjs [webgpu|webgl2] [label]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs', 'evidence', 'T051-sky-fog');
mkdirSync(output, { recursive: true });
const candidates = [process.env.PLAYWRIGHT_CORE_PATH, join(root, 'node_modules', 'playwright-core')].filter(Boolean);
const npx = join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx');
if (existsSync(npx)) for (const entry of readdirSync(npx)) candidates.push(join(npx, entry, 'node_modules', 'playwright-core'));
const packageRoot = candidates.find(candidate => existsSync(join(candidate, 'index.mjs')));
if (!packageRoot) throw new Error('playwright-core 未找到');
const { chromium } = await import(pathToFileURL(join(packageRoot, 'index.mjs')).href);

const backend = process.argv[2] ?? 'webgpu';
const label = process.argv[3] ?? 'main';
const city = { lng: 116.3946533203125, lat: 39.90552253972854 };
const url = new URL('http://127.0.0.1:6661/');
if (backend === 'webgl2') url.searchParams.set('renderer', 'webgl2');
// 前台可见窗口：不使用无头模式，并把 Chrome 窗口与标签页置于激活状态。
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1700,1000', '--window-position=0,0'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();

const result = { kind: 'T051-sky-fog', backend, label, url: String(url), at: new Date().toISOString(), browserVersion: browser.version(),
  foreground: {}, stages: [], motion: {}, themes: {}, basemap: {}, console: [], failures: [], httpErrors: [], assertions: {} };
page.on('requestfailed', request => result.failures.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('response', response => { if (response.status() >= 400) result.httpErrors.push({ url: response.url(), status: response.status() }); });
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning')
  result.console.push({ type: message.type(), text: message.text(), url: message.location()?.url ?? '' }); });
page.on('pageerror', error => result.console.push(`pageerror: ${error.stack ?? error}`));

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const parseHex = value => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];

/** 采集 canvas 的垂直颜色剖面：用于核对天空渐变、底边颜色与内容收敛。 */
async function profile() {
  // 回读在提交帧的同一任务内执行：交换链在合成后不再提供像素。
  return page.evaluate(() => new Promise(resolve => {
    const map = window.__kmapMap3D;
    const off = map.observeFrames(() => {
      off();
      const canvas = document.querySelector('#map-canvas');
      const scratch = document.createElement('canvas');
      scratch.width = canvas.width; scratch.height = canvas.height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, scratch.width, scratch.height);
      const step = Math.max(1, Math.floor(scratch.height / 80));
      const sample = x => {
        const column = context.getImageData(x, 0, 1, scratch.height).data;
        const rows = [];
        for (let y = 0; y < scratch.height; y += step) rows.push({ y, rgb: [column[y * 4], column[y * 4 + 1], column[y * 4 + 2]] });
        return rows;
      };
      resolve({ size: { width: scratch.width, height: scratch.height },
        center: sample(scratch.width >> 1), left: sample(Math.round(scratch.width * .2)), right: sample(Math.round(scratch.width * .8)) });
    });
  }));
}

async function diagnostics() {
  return page.evaluate(() => {
    const map = window.__kmapMap3D;
    return { view: map.getView(), diagnostics: map.getDiagnostics(), frame: map.getFrameState() };
  });
}

/** 等待覆盖稳定：连续多帧无缺口、无待就绪目标，避免层级切换瞬间的短暂满足。 */
async function settle(timeout = 60000) {
  await page.evaluate(limit => new Promise(resolve => {
    const map = window.__kmapMap3D;
    const began = performance.now();
    let stable = 0;
    const covered = () => {
      const diagnostics = map.getDiagnostics();
      if (diagnostics.raster?.enabled) return diagnostics.raster.ready > 0 && diagnostics.raster.patches > 0 && diagnostics.raster.uncovered === 0;
      const tiles = diagnostics.tiles;
      return tiles !== undefined && tiles.targetMissing === 0 && tiles.uncoveredCells === 0 && tiles.target > 0;
    };
    const step = () => {
      stable = covered() ? stable + 1 : 0;
      if (stable >= 10 || performance.now() - began > limit) { resolve(stable); return; }
      requestAnimationFrame(step);
    };
    step();
  }), timeout);
  await page.waitForTimeout(1200);
}

async function shot(name, view) {
  if (view) await page.evaluate(next => window.__kmapMap3D.setView(next), view);
  await settle();
  const image = join(output, `T051-${backend}-${label}-${name}.png`);
  await page.screenshot({ path: image });
  const stage = { name, image, ...(await diagnostics()), profile: await profile() };
  result.stages.push(stage);
  return stage;
}

/** 顶部天空判定：顶部取样更接近天顶色而不是地平线色。 */
function skyVerdict(stage) {
  const zenith = parseHex(stage.diagnostics.sky.zenith), horizon = parseHex(stage.diagnostics.sky.horizon);
  const top = stage.profile.center.slice(0, 4).reduce((sum, row) => [sum[0] + row.rgb[0], sum[1] + row.rgb[1], sum[2] + row.rgb[2]], [0, 0, 0]).map(value => value / 4);
  return { top: top.map(Math.round), zenithDistance: Math.round(distance(top, zenith)), horizonDistance: Math.round(distance(top, horizon)),
    skyVisible: distance(top, zenith) < distance(top, horizon) };
}

/**
 * 雾带到内容的过渡行：自上而下扫描，取最后一处仍与天空模型同色的行。
 * 雾按屏幕行判定时，左中右三列必须落在同一行；按相机距离判定时两侧会明显更深。
 */
function fogEdge(stage) {
  const { boundary, floor: floorHex, zenith: zenithHex } = stage.diagnostics.sky;
  const floor = parseHex(floorHex), zenith = parseHex(zenithHex), height = stage.profile.size.height;
  // 天空渐变在着色器里按线性色空间混合，探针模型必须使用同一空间，否则整段天空都会被判为不匹配。
  const toLinear = value => (value /= 255) <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
  const toSrgb = value => 255 * (value <= .0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - .055);
  const floorLinear = floor.map(toLinear), zenithLinear = zenith.map(toLinear);
  const model = y => {
    const amount = boundary > 0 ? Math.min(1, Math.max(0, (boundary - y) / boundary)) : 0;
    const k = Math.pow(amount, .8);
    return floorLinear.map((value, index) => toSrgb(value + (zenithLinear[index] - value) * k));
  };
  const column = rows => {
    let last = 0;
    for (let i = 0; i + 2 < rows.length; i++) {
      const match = [0, 1, 2].every(offset => distance(rows[i + offset].rgb, model(rows[i].y / (height - 1))) < 26);
      if (match) last = rows[i].y / (height - 1);
    }
    return Number(last.toFixed(4));
  };
  return { center: column(stage.profile.center), left: column(stage.profile.left), right: column(stage.profile.right) };
}

/** 画面颜色跨度：俯视时用于确认地图内容可见，而不是被雾整体吞没。 */
function contentSpread(stage) {
  const rows = stage.profile.center.map(row => row.rgb);
  let spread = 0;
  for (const a of rows) for (const b of rows) spread = Math.max(spread, distance(a, b));
  return Math.round(spread);
}

try {
  await page.goto(String(url), { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  result.foreground = await page.evaluate(() => ({ visibilityState: document.visibilityState, hasFocus: document.hasFocus(),
    userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, screen: { width: window.screen.width, height: window.screen.height } }));

  // 1. 固定俯仰角矩阵：俯视无天空，20° 起顶部出现蓝色天空，75° 保持完整渐变。
  for (const pitch of [0, 20, 26, 40, 60, 75]) {
    const stage = await shot(`pitch${pitch}`, { center: city, zoom: 15.5, bearing: 20, pitch });
    stage.verdict = { ...skyVerdict(stage), spread: contentSpread(stage) };
  }

  // 1b. 高楼场景：近处高楼不能被高屏幕行当成远景吞掉（zoom 17 起显示建筑）。
  for (const pitch of [60, 75]) {
    const stage = await shot(`buildings-pitch${pitch}`, { center: city, zoom: 17, bearing: 20, pitch });
    stage.verdict = { ...skyVerdict(stage), spread: contentSpread(stage) };
  }

  // 2. 连续俯仰、平移、缩放、方位与视口变化：逐帧边界与覆盖连续性。
  const motion = await page.evaluate(async () => {
    const map = window.__kmapMap3D;
    const frames = [];
    const next = () => new Promise(resolve => { const off = map.observeFrames(() => { off(); resolve(); }); });
    const began = performance.now();
    while (performance.now() - began < 14000) {
      const t = (performance.now() - began) / 14000;
      const pitch = t < .5 ? t * 2 * 75 : (1 - t) * 2 * 75;
      map.setView({ center: { lng: 116.3946533203125 + Math.sin(t * Math.PI * 2) * 0.02, lat: 39.90552253972854 },
        zoom: 15.5 + Math.sin(t * Math.PI * 4) * 0.4, bearing: Math.sin(t * Math.PI) * 60, pitch });
      await next();
      frames.push({ ...map.getFrameState(), sky: map.getDiagnostics().sky });
    }
    return frames;
  });
  result.motion.count = motion.length;
  result.motion.boundary = motion.map(frame => Number((frame.sky.boundary).toFixed(4)));
  const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0;
  result.motion.summary = { meanFps: 1000 / (motion.reduce((sum, frame) => sum + frame.ms, 0) / motion.length),
    cpuP95: percentile(motion.map(frame => frame.cpuMs), .95), intervalP95: percentile(motion.map(frame => frame.ms), .95),
    frameMax: Math.max(...motion.map(frame => frame.ms)), cpuMax: Math.max(...motion.map(frame => frame.cpuMs)),
    gpuBytesMax: Math.max(...motion.map(frame => frame.gpuBytes)), cpuBytesMax: Math.max(...motion.map(frame => frame.cpuBytes)) };
  result.motion.samples = motion.map(frame => ({ at: Math.round(frame.at ?? 0), ms: Number(frame.ms.toFixed(2)), cpu: Number(frame.cpuMs.toFixed(2)),
    boundary: Number(frame.sky.boundary.toFixed(4)), fogStart: Math.round(frame.fogStart), fogEnd: Math.round(frame.fogEnd),
    uncovered: frame.uncovered, target: frame.target, sources: frame.sources }));
  // 边界为 0 表示屏幕内没有天空；可见天空范围内按俯仰角增量归一化，检查是否存在突跳。
  const visibleSteps = motion.slice(1).map((frame, i) => ({ step: Math.abs(frame.sky.boundary - motion[i].sky.boundary),
    pitch: Math.abs(frame.view.pitch - motion[i].view.pitch),
    visible: frame.sky.boundary > 0 || motion[i].sky.boundary > 0 })).filter(item => item.visible);
  result.motion.maxBoundaryStep = visibleSteps.length ? Math.max(...visibleSteps.map(item => item.step)) : 0;
  result.motion.maxBoundarySlope = visibleSteps.length
    ? Math.max(...visibleSteps.map(item => item.pitch > .05 ? item.step / item.pitch : 0)) : 0;
  result.motion.uncoveredFrames = motion.filter(frame => frame.uncovered > 0).length;
  result.motion.maxUncovered = Math.max(...motion.map(frame => frame.uncovered));
  result.motion.emptyTargetFrames = motion.filter(frame => !frame.target).length;
  result.motion.fogEnd = [Math.min(...motion.map(frame => frame.fogEnd)), Math.max(...motion.map(frame => frame.fogEnd))];
  const moved = motion.filter(frame => frame.sky.boundary > 0);
  result.motion.skyFrames = moved.length;
  await shot(`motion-settle`, { center: city, zoom: 15.5, bearing: 20, pitch: 55 });

  // 3. 视口变化：边界与天空在同帧跟随，不产生错位。
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(800);
  const resized = await shot(`resize-1100x700`);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(800);
  await shot(`resize-restore`);

  // 4. 主题切换、天顶色与雾色编辑、重置：面板控件走真实用户事件。
  // Inspector 的 select 以选项名（晴昼 · 默认等）作为 DOM 值，按标签定位后派发真实 change。
  const selectTheme = async name => {
    const applied = await page.evaluate(label => {
      const select = document.querySelector('[aria-label="全局主题"]');
      const option = [...select.options].find(item => item.textContent.includes(label));
      if (!option) return undefined;
      select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
      return option.textContent;
    }, name);
    if (!applied) throw new Error(`未找到主题选项：${name}`);
    await page.waitForTimeout(600);
  };
  const setColor = async (name, color) => {
    await page.evaluate(({ name, color }) => {
      const input = document.querySelector(`[aria-label="${name}"]`);
      input.value = color; input.dispatchEvent(new Event('input', { bubbles: true }));
    }, { name, color });
    await page.waitForTimeout(400);
  };
  for (const [name, id] of [['深海', 'dark'], ['晴彩', 'vivid'], ['晴昼', 'default']]) {
    await selectTheme(name);
    const stage = await shot(`theme-${id}`);
    result.themes[id] = { zenith: stage.diagnostics.sky.zenith, horizon: stage.diagnostics.sky.horizon, verdict: skyVerdict(stage) };
  }
  await setColor('天空天顶色', '#7b2ff7');
  const edited = await shot(`theme-zenith-edit`);
  result.themes.zenithEdit = { requested: '#7b2ff7', applied: edited.diagnostics.sky.zenith, verdict: skyVerdict(edited) };
  await setColor('远景雾色', '#f2a35e');
  const fogEdited = await shot(`theme-fog-edit`);
  result.themes.fogEdit = { requested: '#f2a35e', horizon: fogEdited.diagnostics.sky.horizon };
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === '重置当前主题');
    button?.click();
  });
  await page.waitForTimeout(800);
  const reset = await shot(`theme-reset`);
  result.themes.reset = { zenith: reset.diagnostics.sky.zenith, horizon: reset.diagnostics.sky.horizon, verdict: skyVerdict(reset) };

  // 5. 底图状态：纯卫星与卫星叠加线路，远景颜色同样收敛到地平线色。
  await page.evaluate(() => window.__kmapMap3D.setBasemap({ satellite: true, vectorLines: false, labels: false }));
  await page.waitForTimeout(1500);
  const satellite = await shot(`basemap-satellite`, { center: city, zoom: 15.5, bearing: 20, pitch: 60 });
  result.basemap.satellite = { basemap: satellite.diagnostics.basemap, verdict: skyVerdict(satellite) };
  await page.evaluate(() => window.__kmapMap3D.setBasemap({ satellite: true, vectorLines: true, labels: false }));
  await page.waitForTimeout(2500);
  const overlay = await shot(`basemap-satellite-lines`);
  result.basemap.overlay = { basemap: overlay.diagnostics.basemap, verdict: skyVerdict(overlay) };
  await page.evaluate(() => window.__kmapMap3D.setBasemap({ satellite: false, vectorLines: true, labels: true }));
  await page.waitForTimeout(2500);
  const vector = await shot(`basemap-vector`);
  result.basemap.vector = { basemap: vector.diagnostics.basemap, verdict: skyVerdict(vector) };

  // 6. 浮动原点变化：跨区飞行后返回，天空、雾与地面覆盖保持一致。
  const shifted = await shot(`origin-shift`, { center: { lng: 121.4737, lat: 31.2304 }, zoom: 10, bearing: 45, pitch: 65 });
  const restored = await shot(`origin-restore`, { center: city, zoom: 15.5, bearing: 20, pitch: 55 });
  result.origin = { shifted: { origin: shifted.diagnostics.camera.origin, boundary: shifted.diagnostics.sky.boundary, verdict: skyVerdict(shifted) },
    restored: { origin: restored.diagnostics.camera.origin, boundary: restored.diagnostics.sky.boundary, verdict: skyVerdict(restored) } };

  const byName = name => result.stages.find(stage => stage.name === name);
  // 4. 雾形：矢量与卫星两种底图下，左中右三列的雾过渡行必须一致（平面雾，等值线水平）。
  const edges = {};
  for (const name of ['pitch60', 'pitch75', 'basemap-satellite']) {
    const stage = byName(name); edges[name] = { ...fogEdge(stage), boundary: stage.diagnostics.sky.boundary };
  }
  result.fogEdges = edges;
  result.assertions = {
    covered: result.stages.every(stage => stage.diagnostics.raster?.enabled
      ? stage.diagnostics.raster.uncovered === 0 && stage.diagnostics.raster.ready > 0
      : (stage.diagnostics.tiles?.uncoveredCells ?? 1) === 0 && (stage.diagnostics.tiles?.targetMissing ?? 1) === 0),
    noSkyAtTopDown: byName('pitch0').diagnostics.sky.boundary === 0,
    topDownContentVisible: byName('pitch0').verdict.spread > 60,
    // 低倾角雾在可视范围之外：屏幕内既没有雾也没有天空。
    fogStaysFarAtLowTilt: [20, 26, 40].every(pitch => byName(`pitch${pitch}`).diagnostics.sky.boundary === 0
      && byName(`pitch${pitch}`).verdict.skyVisible === false),
    // 近处高楼不被吞：高楼场景下画面仍有强内容对比，而不是整片雾色。
    nearObjectsSurvive: [60, 75].every(pitch => byName(`buildings-pitch${pitch}`).verdict.spread > 120),
    // 内容边界进入视野后天空出现，并随倾角单调增大，75° 位于屏幕顶部 40%。
    skyGrowsWithTilt: [40, 60, 75].every((pitch, i, list) => i === 0
      || byName(`pitch${pitch}`).diagnostics.sky.boundary > byName(`pitch${list[i - 1]}`).diagnostics.sky.boundary)
      && byName('pitch75').diagnostics.sky.boundary > .3 && byName('pitch75').verdict.skyVisible,
    // 雾等值线是水平线：左中右三列的过渡行一致。
    // 阈值 0.05 屏高：相机距离雾在 60° 以上两侧会更深 5%～8%，而三列差值只由内容亮度产生。
    fogIsPlanar: Object.values(edges).every(edge => Math.abs(edge.left - edge.center) <= .05 && Math.abs(edge.right - edge.center) <= .05),
    boundaryMonotonic: [0, 20, 40, 60, 75].map(pitch => byName(`pitch${pitch}`).diagnostics.sky.boundary)
      .every((value, i, list) => i === 0 || value >= list[i - 1]),
    skyBoundaryTracksFog: [60, 75].every(pitch => byName(`pitch${pitch}`).diagnostics.sky.boundary > 0
      && byName(`pitch${pitch}`).diagnostics.sky.boundary < .6),
    motionContinuous: result.motion.maxBoundarySlope < .35 && result.motion.skyFrames > 60,
    motionFogOrdered: result.motion.samples.every(sample => sample.fogStart < sample.fogEnd),
    themesDistinct: new Set(['default', 'dark', 'vivid'].map(id => result.themes[id].zenith)).size === 3,
    themeEditApplied: result.themes.zenithEdit.applied === '#7b2ff7' && result.themes.fogEdit.horizon === '#f2a35e',
    themeResetRestored: result.themes.reset.zenith === result.themes.default.zenith,
    resizedFrames: byName('resize-1100x700').diagnostics.sky.boundary > 0,
    satelliteConverges: result.basemap.satellite.verdict.skyVisible && result.basemap.overlay.verdict.skyVisible,
    originChangeKeepsSky: result.origin.shifted.verdict.skyVisible && result.origin.restored.verdict.skyVisible
      && result.origin.shifted.origin.meters.x !== result.origin.restored.origin.meters.x
      && result.origin.restored.origin.meters.x === byName('pitch0').diagnostics.camera.origin.meters.x,
    // /favicon.ico 为浏览器自动请求；ERR_ABORTED 是视图切换时流水线主动取消；其余错误必须为空。
    noConsoleErrors: result.console.every(message => message.url.endsWith('/favicon.ico'))
      && result.failures.every(failure => failure.error === 'net::ERR_ABORTED') && result.httpErrors.length === 0,
  };
  result.foreground.after = await page.evaluate(() => ({ visibilityState: document.visibilityState, hasFocus: document.hasFocus() }));
} catch (error) {
  result.fatal = String(error.stack ?? error);
} finally {
  writeFileSync(join(output, `T051-${backend}-${label}.json`), JSON.stringify(result, null, 2), 'utf8');
  await browser.close();
}
console.log(JSON.stringify({ backend, fatal: result.fatal, foreground: result.foreground, assertions: result.assertions,
  motion: { count: result.motion.count, summary: result.motion.summary, maxBoundaryStep: result.motion.maxBoundaryStep,
    maxUncovered: result.motion.maxUncovered, uncoveredFrames: result.motion.uncoveredFrames, skyFrames: result.motion.skyFrames, fogEnd: result.motion.fogEnd },
  stages: result.stages.map(stage => ({ name: stage.name, backend: stage.diagnostics.backend, boundary: stage.diagnostics.sky.boundary,
    horizon: stage.diagnostics.sky.horizon, zenith: stage.diagnostics.sky.zenith, verdict: stage.verdict, tiles: stage.diagnostics.tiles?.targetMissing,
    uncovered: stage.diagnostics.tiles?.uncoveredCells, raster: stage.diagnostics.raster?.uncovered, draws: stage.diagnostics.render.drawCalls })),
  themes: result.themes, basemap: result.basemap, console: result.console.slice(0, 10), failures: result.failures.slice(0, 5), httpErrors: result.httpErrors.slice(0, 5) }, null, 2));
if (result.fatal || Object.values(result.assertions ?? {}).some(value => value === false)) process.exitCode = 1;
