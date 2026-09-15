import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import { contains, parentOf, childrenOf, requestUrl, tileBounds } from '../src/streaming/address.js';
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
      const dx = Math.max(x - frame.target.x, 0, frame.target.x - x - b.span);
      const dz = Math.max(z - frame.target.z, 0, frame.target.z - z - b.span);
      expect(Math.hypot(dx, dz)).toBeLessThan(selection.cutoff);
      expect(leaf.z).toBeGreaterThanOrEqual(12); expect(leaf.z).toBeLessThanOrEqual(15);
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
    const selected = selectTiles(camera, frame, origin, view, viewport, 0, 17);
    expect(selected.leaves.length).toBeLessThanOrEqual(80);
    expect(Math.min(...selected.leaves.map(a => a.z))).toBeGreaterThanOrEqual(14);
    for (const a of selected.leaves) for (const b of selected.leaves) if (a !== b) expect(contains(a, b)).toBe(false);
  });
});
