import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/evidence/T046-tile-render-ownership');
mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
const candidates = [process.env.PLAYWRIGHT_CORE_PATH, join(root, 'node_modules/playwright-core')].filter(Boolean);
const cache = join(process.env.LOCALAPPDATA ?? '', 'npm-cache/_npx');
if (existsSync(cache)) for (const name of readdirSync(cache)) candidates.push(join(cache, name, 'node_modules/playwright-core'));
const playwright = candidates.find(candidate => existsSync(join(candidate, 'index.js')));
if (!playwright) throw new Error('playwright-core 未找到');
const { chromium } = require(playwright);
const backend = process.argv[2] ?? 'webgl2';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1707, height: 932 }, deviceScaleFactor: 1.5 });
const result = { at: new Date().toISOString(), backend, browser: browser.version(), control: {}, guarded: {}, stages: [], errors: [], warnings: [], networkErrors: [], assertions: {} };
page.on('pageerror', error => result.errors.push(String(error)));
page.on('response', response => { if (response.status() >= 400) result.networkErrors.push({ url: response.url(), status: response.status() }); });
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) result.errors.push(message.text());
  if (message.type() === 'warning') result.warnings.push(message.text());
});

try {
  await page.goto(`http://127.0.0.1:6661/${backend === 'webgl2' ? '?renderer=webgl2' : ''}`);
  await page.waitForFunction(() => window.__kmapStatus?.state === 'ready', undefined, { timeout: 90000 });
  await page.evaluate(() => window.__kmapMap3D.stop());
  for (const guarded of [false, true]) {
    const probe = await page.evaluate(async ({ guarded, backend }) => {
      const prefix = '/@fs/D:/code/kmap/packages/map3d/src/';
      const source = await (await fetch(`${prefix}streaming/fillSurface.ts`)).text();
      const threePath = source.match(/from "([^"]*three_webgpu[^"]*)"/)[1];
      const { Color, Scene, PerspectiveCamera, WebGPURenderer } = await import(threePath);
      const { createFillSurface, releaseFillSurface } = await import(`${prefix}streaming/fillSurface.ts`);
      const { GeometryPool } = await import(`${prefix}streaming/geometryPool.ts`);
      const { DrawSlotPool } = await import(`${prefix}streaming/drawSlots.ts`);
      const { installGeometryDisposalGuard } = await import(`${prefix}rendering/geometryDisposal.ts`);
      const canvas = document.createElement('canvas');
      const renderer = new WebGPURenderer({ canvas, forceWebGL: backend === 'webgl2', antialias: false });
      await renderer.init(); renderer.setSize(128, 128);
      if (guarded) installGeometryDisposalGuard(renderer);
      const scene = new Scene(); scene.background = new Color('#fff8e7');
      const camera = new PerspectiveCamera(45, 1, .01, 10);
      camera.position.set(0, 2, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      const pool = new GeometryPool(), slots = new DrawSlotPool();
      const capture = () => {
        const context = new OffscreenCanvas(128, 128).getContext('2d');
        context.drawImage(canvas, 0, 0); return Array.from(context.getImageData(64, 64, 1, 1).data);
      };
      const data = color => ({ positions: new Float32Array([-.5, 0, -.5, -.5, 0, .5, .5, 0, -.5, .5, 0, .5]),
        colors: new Float32Array(Array(4).fill(color).flat()), styles: new Float32Array([0, 25, 1, 0, 25, 1, 0, 25, 1, 0, 25, 1]),
        indices: new Uint32Array([0, 1, 2, 1, 3, 2]) });
      const samples = []; let previous; let mesh;
      for (const [cycle, color] of [[1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 0]].entries()) {
        const fill = createFillSurface(data(color), false, undefined, slots);
        fill.mesh.material.stencilWrite = false; scene.add(fill.mesh);
        renderer.render(scene, camera); await new Promise(requestAnimationFrame);
        renderer.render(scene, camera);
        const buffers = Object.values(fill.mesh.geometry.attributes).map(attribute => renderer.backend.get(attribute).bufferGPU);
        const gl = renderer.backend.gl;
        const liveBefore = gl ? buffers.map(buffer => gl.isBuffer(buffer)) : undefined;
        if (previous) previous.dispose();
        const liveAfter = gl ? buffers.map(buffer => gl.isBuffer(buffer)) : undefined;
        const updatedColor = color.map(value => 1 - value);
        const attribute = fill.mesh.geometry.getAttribute('fillColor');
        for (let vertex = 0; vertex < attribute.count; vertex++) attribute.array.set(updatedColor, vertex * 3);
        attribute.needsUpdate = true;
        renderer.render(scene, camera); await new Promise(requestAnimationFrame); renderer.render(scene, camera);
        samples.push({ cycle, sameMesh: mesh === undefined || mesh === fill.mesh, expected: [...updatedColor.map(value => value * 255), 255],
          actual: capture(), liveBefore, liveAfter, glError: gl?.getError() });
        mesh = fill.mesh; previous = fill.mesh.geometry;
        releaseFillSurface(fill, pool, slots);
      }
      pool.dispose(); slots.dispose(); renderer.dispose();
      return { samples, invalidatedCurrentBuffers: samples.filter(sample => sample.liveAfter?.some(value => !value)).length,
        wrongPixels: samples.filter(sample => sample.actual.some((value, index) => Math.abs(value - sample.expected[index]) > 3)).length };
    }, { guarded, backend });
    result[guarded ? 'guarded' : 'control'] = probe;
  }
  await page.evaluate(async () => {
    const { THEMES } = await import('/src/themes.ts');
    const map = window.__kmapMap3D; map.setTheme(THEMES.vivid); map.start();
  });
  const cases = [
    { name: 'bay-z10', center: { lng: 118.014582, lat: 38.993828 }, zoom: 10.52, bearing: 298.2, pitch: 36.4 },
    { name: 'tianjin-z11-a', center: { lng: 117.633547, lat: 38.608656 }, zoom: 11.18, bearing: 292.2, pitch: 44.3 },
    { name: 'tianjin-z11-b', center: { lng: 117.662274, lat: 38.795552 }, zoom: 11.18, bearing: 292.2, pitch: 44.3 },
    { name: 'hubei-z6', center: { lng: 112.559589, lat: 30.810449 }, zoom: 6.83, bearing: 40.7, pitch: 49.4 },
    { name: 'hubei-z7', center: { lng: 112.198079, lat: 31.350933 }, zoom: 7.68, bearing: 40.7, pitch: 49.4 },
  ];
  for (const view of cases) {
    await page.evaluate(async view => {
      const map = window.__kmapMap3D; map.setView(view);
      let stable = 0; const began = performance.now();
      while (stable < 8 && performance.now() - began < 90000) {
        await new Promise(requestAnimationFrame);
        const tiles = map.getDiagnostics().tiles;
        stable = tiles.idle && tiles.targetMissing === 0 && tiles.uncoveredCells === 0 ? stable + 1 : 0;
      }
      if (stable < 8) throw new Error('固定视点覆盖收敛超时');
    }, view);
    const stage = await page.evaluate(() => {
      const map = window.__kmapMap3D, diagnostics = map.getDiagnostics();
      const gl = map.renderer.backend.gl; const errors = [];
      const draw = map.renderer.backend.draw;
      map.renderer.backend.draw = function (object, ...args) {
        if (gl) for (const attribute of object.getAttributes()) {
          if (!gl.isBuffer(this.get(attribute).bufferGPU)) errors.push({ mesh: object.object.uuid, attribute: attribute.id });
        }
        return draw.call(this, object, ...args);
      };
      map.renderer.render(map.scene, map.camera); map.renderer.backend.draw = draw;
      return { backend: diagnostics.backend, view: diagnostics.view, viewport: diagnostics.viewport, target: diagnostics.tiles.target,
        committed: diagnostics.tiles.committed, missing: diagnostics.tiles.targetMissing, uncovered: diagnostics.tiles.uncoveredCells,
        drawnLevels: diagnostics.tiles.drawnLevels, resources: diagnostics.tiles.resources, invalidBuffers: errors, glError: gl?.getError() };
    });
    const screenshot = `${backend}-${view.name}.png`;
    await page.screenshot({ path: join(output, screenshot) });
    result.stages.push({ name: view.name, screenshot, ...stage });
  }
  await page.evaluate(async () => {
    const map = window.__kmapMap3D;
    for (let frame = 0; frame < 1200; frame++) {
      const phase = frame / 170;
      map.setView({ center: { lng: 118.01 + .4 * Math.sin(phase * 2), lat: 38.99 + .25 * Math.cos(phase * 1.3) },
        zoom: 10.52 + 2 * Math.sin(phase * 2.2), bearing: 298.2 + 80 * Math.sin(phase), pitch: 36.4 + 18 * Math.sin(phase * 1.1) });
      await new Promise(requestAnimationFrame);
    }
  });
  await page.evaluate(async view => {
    const map = window.__kmapMap3D; map.setView(view);
    let stable = 0; const began = performance.now();
    while (stable < 8 && performance.now() - began < 90000) {
      await new Promise(requestAnimationFrame);
      const tiles = map.getDiagnostics().tiles;
      stable = tiles.idle && tiles.targetMissing === 0 && tiles.uncoveredCells === 0 ? stable + 1 : 0;
    }
    if (stable < 8) throw new Error('运动回访覆盖收敛超时');
  }, cases[0]);
  result.motion = await page.evaluate(async () => {
    const map = window.__kmapMap3D, diagnostics = map.getDiagnostics();
    const invalidBuffers = [], gl = map.renderer.backend.gl, draw = map.renderer.backend.draw;
    map.renderer.backend.draw = function (object, ...args) {
      if (gl) for (const attribute of object.getAttributes()) {
        if (!gl.isBuffer(this.get(attribute).bufferGPU)) invalidBuffers.push({ mesh: object.object.uuid, attribute: attribute.id });
      }
      return draw.call(this, object, ...args);
    };
    for (let frame = 0; frame < 12; frame++) await new Promise(requestAnimationFrame);
    map.renderer.backend.draw = draw;
    return { frames: 1200, target: diagnostics.tiles.target, committed: diagnostics.tiles.committed, missing: diagnostics.tiles.targetMissing,
      uncovered: diagnostics.tiles.uncoveredCells, resources: diagnostics.tiles.resources, invalidBuffers, glError: gl?.getError() };
  });
  await page.screenshot({ path: join(output, `${backend}-motion-return.png`) });
  result.disposal = await page.evaluate(async () => {
    const map = window.__kmapMap3D; map.stop();
    await window.__kmapInspector?.resolveTimestamp();
    map.dispose();
    const diagnostics = map.getDiagnostics();
    return { resources: diagnostics.tiles?.resources, memory: diagnostics.memory, stats: map.getStats().resources };
  });
  result.assertions = { controlReproduced: backend !== 'webgl2' || result.control.invalidatedCurrentBuffers > 0 && result.control.wrongPixels > 0,
    guardedBuffers: result.guarded.invalidatedCurrentBuffers === 0, guardedPixels: result.guarded.wrongPixels === 0,
    backend: result.stages.every(stage => stage.backend === backend),
    steadyCoverage: result.stages.every(stage => stage.missing === 0 && stage.uncovered === 0),
    steadyBuffers: result.stages.every(stage => stage.invalidBuffers.length === 0 && (stage.glError ?? 0) === 0),
    motionCoverage: result.motion.missing === 0 && result.motion.uncovered === 0 && (result.motion.glError ?? 0) === 0,
    motionBuffers: result.motion.invalidBuffers.length === 0,
    runtimeErrors: result.errors.length === 0 && result.warnings.length === 0,
    disposed: result.disposal.stats.cpuBytes === 0 && result.disposal.stats.gpuBytes === 0 };
} catch (error) { result.fatal = String(error.stack ?? error); }
finally {
  await browser.close();
  writeFileSync(join(output, `${backend}.json`), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({ backend, fatal: result.fatal, assertions: result.assertions, control: result.control, guarded: result.guarded,
  motion: result.motion, errors: result.errors, warnings: result.warnings }, null, 2));
if (result.fatal || Object.values(result.assertions).some(value => !value)) process.exitCode = 1;
