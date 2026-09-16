import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from '../packages/map3d/node_modules/three/build/three.webgpu.js';
import { localTileZoom } from '../packages/map3d/src/streaming/coveringTiles.js';
import { updateMapCamera } from '../packages/map3d/src/rendering/mapCamera.js';
import { selectMapOrigin } from '../packages/map3d/src/spatial/mapOrigin.js';
import { contains, keyOf, tileBounds } from '../packages/map3d/src/streaming/address.js';
it('运行原始浏览器覆盖的屏幕位置审计', () => {
  const directory = 'docs/evidence/streaming-rebuild/';
  const d = JSON.parse(readFileSync(process.env.KMAP_AUDIT_REPORT ?? directory + 'webgpu-2026-09-15T17-44-09-869Z.json', 'utf8'));
  const frames = d.renderFrames.filter((f: any) => f.gap > 3 || f.uncovered > 0);
  const covers = new Map<number, any>(d.covers.map((c: any) => [c.revision, c]));
  const camera = new PerspectiveCamera(); const result: any[] = []; let last = -Infinity;
  for (const f of frames) {
    if (f.atMs - last < 100 && !f.uncovered) continue; last = f.atMs;
    const cover = covers.get(f.revision); const origin = selectMapOrigin(f.view.center, Math.floor(f.view.zoom));
    const frame = updateMapCamera(camera, f.view, { width: 2560, height: 1305 }, origin);
    const sample = d.samples.reduce((a: any, b: any) => Math.abs(b.atMs - f.atMs) < Math.abs(a.atMs - f.atMs) ? b : a);
    const cutoff = f.cutoff ?? sample.diagnostics.tiles.footprint.loadCutoff * frame.distance / (sample.diagnostics.camera.position.y / Math.cos(sample.diagnostics.view.pitch * Math.PI / 180));
    const sources: any[] = []; let total = 0; let near = 0; let nearBad = 0; let bad = 0; let missing = 0;
    for (let y = 0; y < 27; y++) for (let x = 0; x < 48; x++) {
      const ndcy = 1 - (y + .5) * 2 / 27; const ray = new Vector3((x + .5) * 2 / 48 - 1, ndcy, .5).unproject(camera).sub(camera.position);
      const point = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
      if (point.distanceTo(camera.position) >= cutoff) continue;
      const position = { z: 23, x: Math.floor((point.x + origin.meters.x + 20037508.342789244) / 40075016.68557849 * 2 ** 23),
        y: Math.floor((20037508.342789244 - origin.meters.y + point.z) / 40075016.68557849 * 2 ** 23) };
      const distance = point.distanceTo(camera.position);
      const targetZoom = Math.min(17, Math.floor(f.view.pitch > 56 ? localTileZoom(f.view.zoom, frame.distance, distance, camera.position.y, camera.fov) : f.view.zoom));
      const target = { z: targetZoom, x: Math.floor(position.x / 2 ** (23 - targetZoom)), y: Math.floor(position.y / 2 ** (23 - targetZoom)) };
      total++; if (y >= 18) near++;
      const patch = cover.patches.find((p: any) => contains(p.cell, position));
      if (!patch) { missing++; sources.push({ x, y, missing: keyOf(target) }); continue; }
      const gap = target.z - patch.source.z;
      if (gap > 2) { bad++; if (y >= 18) nearBad++; sources.push({ x, y, target: keyOf(target), source: keyOf(patch.source), gap }); }
    }
    result.push({ atMs: f.atMs, stage: f.stage, reportedGap: f.gap, reportedUncovered: f.uncovered, total, missing, bad, near, nearBad, sources });
  }
  writeFileSync(directory + 'T046-screen-coverage-audit.json', JSON.stringify({ method: '48x27 visible ground samples, pointwise ideal LOD, recorded render sources and fog', source: process.env.KMAP_AUDIT_REPORT, frames: result }, null, 2));
  console.log(JSON.stringify({ frames: result.length, missingPeak: Math.max(...result.map(f => f.missing / f.total)), badPeak: Math.max(...result.map(f => f.bad / f.total)), nearBadPeak: Math.max(...result.map(f => f.nearBad / f.near)), gaps: result.filter(f => f.reportedUncovered).map(f => ({ atMs: f.atMs, missing: f.missing, sources: f.sources.filter((s: any) => s.missing) })) }));
});

it('定位海面白区的提交来源', () => {
  const dir = 'docs/evidence/streaming-rebuild/';
  const d = JSON.parse(readFileSync(dir + 'webgpu-2026-09-15T17-54-09-878Z.json', 'utf8'));
  const covers = new Map<number, any>(d.covers.map((c: any) => [c.revision, c]));
  const camera = new PerspectiveCamera(); let last = 0; const result: any[] = [];
  for (const f of d.renderFrames) {
    if (f.atMs < 23000 || f.atMs > 24700 || f.atMs - last < 50) continue; last = f.atMs;
    const origin = selectMapOrigin(f.view.center, Math.floor(f.view.zoom));
    updateMapCamera(camera, f.view, { width: 2560, height: 1305 }, origin);
    const ray = new Vector3(.8, 0, .5).unproject(camera).sub(camera.position);
    const point = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
    const position = { z: 23, x: Math.floor((point.x + origin.meters.x + 20037508.342789244) / 40075016.68557849 * 2 ** 23),
      y: Math.floor((20037508.342789244 - origin.meters.y + point.z) / 40075016.68557849 * 2 ** 23) };
    const patch = covers.get(f.revision).patches.find((p: any) => contains(p.cell, position));
    const bounds = patch ? tileBounds(patch.source) : undefined;
    result.push({ atMs: f.atMs, view: f.view, patch, uv: bounds ? { x: (point.x + origin.meters.x - bounds.west) / bounds.span, y: (bounds.north - origin.meters.y + point.z) / bounds.span } : undefined });
  }
  writeFileSync(dir + 'T046-sea-sources.json', JSON.stringify(result, null, 2));
});
