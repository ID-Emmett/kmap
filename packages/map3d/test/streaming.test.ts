import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { contains, parentOf, childrenOf, requestUrl, tileBounds } from '../src/streaming/address.js';
import { distanceToGroundBox } from '../src/streaming/fog.js';
import { localTileZoom } from '../src/streaming/coveringTiles.js';
import { selectTiles } from '../src/streaming/selection.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { Samples } from '../src/streaming/samples.js';
import { decodeVectorTile, matches } from '../src/streaming/paint.js';
import { readFileSync } from 'node:fs';

describe('流式地图空间与数据契约', () => {
  it('负世界副本和父子地址保持正确的网络归一化', () => {
    expect(requestUrl({ z: 2, x: -1, y: 1 }, ['/{z}/{x}/{y}'])).toBe('/2/3/1');
    const a = { z: 4, x: -3, y: 6 };
    for (const child of childrenOf(a)) { expect(parentOf(child)).toEqual(a); expect(contains(a, child)).toBe(true); }
    expect(contains(a, { z: 3, x: -1, y: 3 })).toBe(false);
  });
  it('真实 MVT fixture 包含道路、地块和建筑', () => {
    const data = readFileSync(new URL('./fixtures/kye-main-z15-26978-12416.mvt', import.meta.url));
    const tile = decodeVectorTile(data);
    for (const name of ['road', 'landuse', 'building']) expect(tile.layers[name]!.length).toBeGreaterThan(0);
    expect(matches({ class: 'primary' }, [{ operator: 'in', property: 'class', values: ['primary'] }])).toBe(true);
  });
  it.each([0, 20, 40, 60])('倾角 %s° 的选片有界且雾区以外被剔除', pitch => {
    const view = { center: { lng: 116.39, lat: 39.9 }, zoom: 15, bearing: 35, pitch };
    const viewport = { width: 1280, height: 720 }; const camera = new PerspectiveCamera();
    const origin = selectMapOrigin(view.center, 15); const frame = updateMapCamera(camera, view, viewport, origin);
    const selection = selectTiles(camera, frame, origin, view, viewport, 0, 17);
    expect(selection.leaves.length).toBeGreaterThan(8); expect(selection.leaves.length).toBeLessThan(120);
    expect(selection.visited).toBeLessThan(1500); expect(selection.culled).toBeGreaterThan(0);
    for (const leaf of selection.leaves) {
      const b = tileBounds(leaf); const x = b.west - origin.meters.x; const z = origin.meters.y - b.north;
      const distance = distanceToGroundBox(x, z, b.span, frame.position);
      expect(distance).toBeLessThan(selection.cutoff);
      const expected = pitch > 56 ? Math.floor(localTileZoom(view.zoom, frame.distance, distance, frame.position.y, camera.fov)) : 15;
      expect(leaf.z).toBeGreaterThanOrEqual(Math.max(0, Math.min(17, expected)));
      expect(leaf.z).toBeLessThanOrEqual(17);
      const p = tileBounds(parentOf(leaf));
      const pd = distanceToGroundBox(p.west - origin.meters.x, origin.meters.y - p.north, p.span, frame.position);
      const t = Math.min(1, Math.max(0, (pd - selection.fogStart) / (selection.fogEnd - selection.fogStart)));
      const parentLocal = pitch > 56 ? localTileZoom(view.zoom, frame.distance, pd, frame.position.y, camera.fov) : 15;
      const parentDesired = Math.floor(t * t * (3 - 2 * t) < .9 ? Math.max(view.zoom, parentLocal) : parentLocal);
      expect(leaf.z - 1).toBeLessThan(parentDesired);
    }
  });
  it('98% 雾距离与渲染曲线对应，完全入雾的小区域不进入可见集', () => {
    const view = { center: { lng: 116.39, lat: 39.9 }, zoom: 15, bearing: 0, pitch: 60 };
    const viewport = { width: 2560, height: 1305 }; const camera = new PerspectiveCamera();
    const origin = selectMapOrigin(view.center, 15); const frame = updateMapCamera(camera, view, viewport, origin);
    const selected = selectTiles(camera, frame, origin, view, viewport, 0, 17, 1, 80);
    const t = (selected.cutoff - selected.fogStart) / (selected.fogEnd - selected.fogStart);
    expect(t * t * (3 - 2 * t)).toBeCloseTo(.98, 5);
    const world = 40075016.68557849;
    for (const x of [-.8, 0, .8]) {
      const ray = new Vector3(x, .98, .5).unproject(camera).sub(camera.position);
      const point = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
      expect(point.distanceTo(camera.position)).toBeGreaterThan(selected.cutoff);
      const a = { z: 17, x: Math.floor((point.x + origin.meters.x + world / 2) / world * 2 ** 17),
        y: Math.floor((world / 2 - origin.meters.y + point.z) / world * 2 ** 17) };
      expect(selected.visible(a)).toBe(false);
    }
  });
  it('采样环保持序号、时间顺序与完整 P95', () => {
    const samples = new Samples(); for (let i = 1; i <= 500; i++) samples.add(i);
    const result = samples.snapshot(); expect(result.totalCount).toBe(500); expect(result.values).toHaveLength(240);
    expect(result.values[0]).toBe(261); expect(result.last).toBe(500); expect(result.p95).toBe(488);
  });
  it('大视口的层级合并保持工作集上限和地址互斥', () => {
    const view = { center: { lng: 116.39, lat: 39.9 }, zoom: 16, bearing: 45, pitch: 60 };
    const viewport = { width: 2560, height: 1440 }; const camera = new PerspectiveCamera();
    const origin = selectMapOrigin(view.center, 16); const frame = updateMapCamera(camera, view, viewport, origin);
    const selected = selectTiles(camera, frame, origin, view, viewport, 0, 17, 1, 80);
    expect(selected.leaves.length).toBeLessThanOrEqual(80);
    // 下半屏逐点核验局部投影细节，完全入雾区域单独剔除。
    for (const y of [-.9, -.5, 0]) for (const x of [-.8, -.4, 0, .4, .8]) {
      const ray = new Vector3(x, y, .5).unproject(camera).sub(camera.position);
      const ground = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
      const distance = ground.distanceTo(camera.position);
      const leaf = selected.leaves.find(a => {
        const b = tileBounds(a); const gx = ground.x + origin.meters.x; const gy = origin.meters.y - ground.z;
        return gx >= b.west && gx < b.west + b.span && gy <= b.north && gy > b.north - b.span;
      });
      expect(leaf).toBeDefined();
      const expected = Math.min(17, Math.floor(localTileZoom(view.zoom, frame.distance, distance, camera.position.y, camera.fov)));
      expect(leaf!.z).toBeGreaterThanOrEqual(expected);
    }
    expect(selected.fogCulled).toBeGreaterThan(0);
    for (const a of selected.leaves) for (const b of selected.leaves) if (a !== b) expect(contains(a, b)).toBe(false);
  });
});
