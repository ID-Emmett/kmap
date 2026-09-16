import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from '../packages/map3d/node_modules/three/build/three.webgpu.js';
import { selectTiles } from '../packages/map3d/src/streaming/coveringTiles.js';
import { tileBounds } from '../packages/map3d/src/streaming/address.js';
import { updateMapCamera } from '../packages/map3d/src/rendering/mapCamera.js';
import { selectMapOrigin } from '../packages/map3d/src/spatial/mapOrigin.js';
import { PITCH_CASES } from '../apps/playground/src/pitchBenchmark.js';

it('记录用户视角及预算压力视角的目标与屏幕区域层级', () => {
  const viewport = { width: 2560, height: 1305 };
  const cases = [...PITCH_CASES, ...[15, 16].map(zoom => ({ name: `pressure-z${zoom}`, view: { ...PITCH_CASES[1]!.view, zoom } }))];
  const results = cases.map(({ name, view }) => {
    const origin = selectMapOrigin(view.center, Math.floor(view.zoom)), camera = new PerspectiveCamera();
    const frame = updateMapCamera(camera, view, viewport, origin);
    const selected = selectTiles(camera, frame, origin, view, viewport, 0, 17);
    const uniform = selectTiles(camera, frame, origin, view, viewport, Math.floor(view.zoom), Math.floor(view.zoom), 1, 1000);
    const levels = (items: typeof selected.leaves) => items.reduce<Record<number, number>>((r, a) => { r[a.z] = (r[a.z] ?? 0) + 1; return r; }, {});
    const zones = { near: { samples: 0, downgraded: 0, levels: {} as Record<number, number> },
      middle: { samples: 0, downgraded: 0, levels: {} as Record<number, number> },
      far: { samples: 0, downgraded: 0, levels: {} as Record<number, number> } };
    let missing = 0;
    for (let row = 0; row < 60; row++) for (let column = 0; column < 100; column++) {
      const ray = new Vector3((column + .5) / 50 - 1, 1 - (row + .5) / 30, .5).unproject(camera).sub(camera.position);
      if (ray.y >= 0) continue;
      const point = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
      const distance = point.distanceTo(camera.position); if (distance >= selected.cutoff) continue;
      const t = Math.min(1, Math.max(0, (distance - selected.fogStart) / (selected.fogEnd - selected.fogStart)));
      const zone = t * t * (3 - 2 * t) >= .9 ? zones.far : row < 30 ? zones.middle : zones.near;
      const gx = point.x + origin.meters.x, gy = origin.meters.y - point.z;
      const target = selected.leaves.find(a => { const b = tileBounds(a); return gx >= b.west && gx < b.west + b.span && gy <= b.north && gy > b.north - b.span; });
      if (!target) { missing++; continue; }
      zone.samples++; zone.levels[target.z] = (zone.levels[target.z] ?? 0) + 1;
      if (target.z < Math.floor(view.zoom)) zone.downgraded++;
    }
    expect(selected.leaves.length).toBeLessThanOrEqual(128); expect(missing).toBe(0);
    if (!name.startsWith('pressure')) { expect(zones.near.downgraded).toBe(0); expect(zones.middle.downgraded).toBe(0); }
    return { name, view, idealCount: selected.ideal.length, targetCount: selected.leaves.length, uniformCount: uniform.leaves.length,
      budgetReduced: selected.budgetReduced, fogCulled: selected.fogCulled, levels: levels(selected.leaves), idealLevels: levels(selected.ideal), zones, missing };
  });
  const report = { kind: 'offline-selection', viewport, at: new Date().toISOString(), results };
  writeFileSync('docs/evidence/streaming-rebuild/T046-pitch-selection.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
});
