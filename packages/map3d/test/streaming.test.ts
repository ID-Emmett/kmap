import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { contains, parentOf, childrenOf, requestUrl, tileBounds } from '../src/streaming/address.js';
import { distanceToGroundBox, FOG_CUTOFF_ROOT, fogCornerCoverage, fogDistances, fogRowForDistance } from '../src/streaming/fog.js';
import { selectTiles } from '../src/streaming/selection.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { Samples } from '../src/streaming/samples.js';
import { decodeVectorTile, matches } from '../src/streaming/paint.js';
import { readFileSync } from 'node:fs';

describe('流式地图空间与数据契约', () => {
  it('父子地址与网络 URL 使用同一层级索引', () => {
    expect(requestUrl({ z: 2, x: 3, y: 1 }, ['/{z}/{x}/{y}'])).toBe('/2/3/1');
    const a = { z: 4, x: 3, y: 6 };
    for (const child of childrenOf(a)) { expect(parentOf(child)).toEqual(a); expect(contains(a, child)).toBe(true); }
    expect(contains(a, { z: 3, x: 1, y: 3 })).toBe(false);
  });
  it('真实 MVT fixture 包含道路、地块和建筑', () => {
    const data = readFileSync(new URL('./fixtures/kye-main-z15-26978-12416.mvt', import.meta.url));
    const tile = decodeVectorTile(data);
    for (const name of ['road', 'landuse', 'building']) expect(tile.layers[name]!.length).toBeGreaterThan(0);
    expect(matches({ class: 'primary' }, [{ operator: 'in', property: 'class', values: ['primary'] }])).toBe(true);
  });
  it.each([0, 20, 40, 60, 75])('倾角 %s° 的选片有界且雾区以外被剔除', pitch => {
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
      expect(leaf.z).toBe(15);
    }
  });
  it('雾按屏幕行判定：选片半径按横向展宽放大，边缘在完全入雾前不被剔除', () => {
    const view = { center: { lng: 116.39, lat: 39.9 }, zoom: 15, bearing: 0, pitch: 60 };
    const viewport = { width: 2560, height: 1305 }; const camera = new PerspectiveCamera();
    const origin = selectMapOrigin(view.center, 15); const frame = updateMapCamera(camera, view, viewport, origin);
    const selected = selectTiles(camera, frame, origin, view, viewport, 0, 17, 1, 80);
    const fog = fogDistances(frame, view.pitch);
    const ninetyEight = fog.start + (fog.end - fog.start) * FOG_CUTOFF_ROOT;
    // 选片半径 = 98% 入雾距离 × 横向展宽系数；系数取同行边缘与中心的最大距离比。
    expect(selected.cutoff).toBeCloseTo(ninetyEight * fogCornerCoverage(viewport), 6);
    // 98% 入雾行上，屏幕边缘的地面距离比中心更远，但仍在选片半径内，因此不会先被剔除。
    const row = fogRowForDistance(frame, view.pitch, ninetyEight);
    const edge = new Vector3(1, 1 - 2 * row, .5).unproject(camera).sub(camera.position);
    const corner = camera.position.clone().addScaledVector(edge, -camera.position.y / edge.y);
    const cornerDistance = corner.distanceTo(camera.position);
    expect(cornerDistance).toBeGreaterThan(ninetyEight);
    expect(cornerDistance).toBeLessThan(selected.cutoff);
    // 超出选片半径的远处区域不进入可见集。
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion); forward.y = 0; forward.normalize();
    const far = camera.position.clone().addScaledVector(forward, selected.cutoff * 1.2); const world = 40075016.68557849;
    const a = { z: 17, x: Math.floor((far.x + origin.meters.x + world / 2) / world * 2 ** 17),
      y: Math.floor((world / 2 - origin.meters.y + far.z) / world * 2 ** 17) };
    expect(selected.visible(a)).toBe(false);
  });
  it('采样环保持序号、时间顺序与完整 P95', () => {
    const samples = new Samples(); for (let i = 1; i <= 500; i++) samples.add(i);
    const result = samples.snapshot(); expect(result.totalCount).toBe(500); expect(result.values).toHaveLength(240);
    expect(result.values[0]).toBe(261); expect(result.last).toBe(500); expect(result.p95).toBe(488);
  });
  it('大视口使用统一目标层级并保持工作集上限和地址互斥', () => {
    const view = { center: { lng: 116.39, lat: 39.9 }, zoom: 16, bearing: 45, pitch: 60 };
    const viewport = { width: 2560, height: 1440 }; const camera = new PerspectiveCamera();
    const origin = selectMapOrigin(view.center, 16); const frame = updateMapCamera(camera, view, viewport, origin);
    const selected = selectTiles(camera, frame, origin, view, viewport, 0, 17, 1, 80);
    expect(selected.leaves.length).toBeLessThanOrEqual(80);
    // 下半屏逐点核验局部投影细节，完全入雾区域单独剔除。
    for (const y of [-.9, -.5, 0]) for (const x of [-.8, -.4, 0, .4, .8]) {
      const ray = new Vector3(x, y, .5).unproject(camera).sub(camera.position);
      const ground = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
      const leaf = selected.leaves.find(a => {
        const b = tileBounds(a); const gx = ground.x + origin.meters.x; const gy = origin.meters.y - ground.z;
        return gx >= b.west && gx < b.west + b.span && gy <= b.north && gy > b.north - b.span;
      });
      expect(leaf).toBeDefined();
      expect(leaf!.z).toBe(selected.leaves[0]!.z);

    }
    expect(new Set(selected.leaves.map(a => a.z)).size).toBe(1);
    expect(selected.fogCulled).toBeGreaterThan(0);
    for (const a of selected.leaves) for (const b of selected.leaves) if (a !== b) expect(contains(a, b)).toBe(false);
  });
});
