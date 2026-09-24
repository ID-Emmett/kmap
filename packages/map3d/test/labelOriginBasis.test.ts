import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Color, PerspectiveCamera, Scene } from 'three/webgpu';
import { decodeGlyphs } from '../src/labels/glyphs.js';
import { LabelSystem } from '../src/labels/labelSystem.js';
import type { LabelCandidate } from '../src/labels/candidates.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** 相邻瓦片偏移，用于构造跨帧布局所需的候选规模。 */
const TILE_OFFSETS = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2], [3, 0], [3, 1], [3, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 0], [4, 1], [4, 2], [4, 3]] as const;

function candidatesFor(tileKey: string): LabelCandidate[] {
  const labels: LabelCandidate[] = [];
  for (let i = 0; i < 60; i++) labels.push({ text: '中', x: (i % 10) / 10 + .05, y: Math.floor(i / 10) / 6 + .05, endX: .5, endY: .5, line: false,
    key: `${tileKey}:k${i}`, priority: i, minZoom: 12, maxZoom: 25, size: 16, color: '#333', haloColor: '#fff', haloWidth: 1 });
  return labels;
}

describe('文字渲染基准', () => {
  it('跨帧布局进行中遇到浮动原点突变，已提交批次的顶点基准保持不变', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#fff'));
    const viewport = { width: 1280, height: 720 };
    const view = { center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 15.2, bearing: 0, pitch: 0 };
    const origin = selectMapOrigin(view.center, 15), camera = new PerspectiveCamera();
    updateMapCamera(camera, view, viewport, origin);
    const draws: { cell: { z: number; x: number; y: number }; source: { z: number; x: number; y: number }; key: string }[] = [];
    const resources = new Map<string, { surface: ReturnType<TileSurfaces['create']> }>();
    for (const [dx, dy] of TILE_OFFSETS) {
      const address = { z: 15, x: 26978 + dx, y: 12416 + dy }, key = `${address.z}/${address.x}/${address.y}`;
      const resource = surfaces.create({ width: 1, height: 1, close() {} } as ImageBitmap, address, undefined, undefined, undefined, candidatesFor(key));
      draws.push({ cell: address, source: address, key }); resources.set(key, { surface: resource });
    }
    surfaces.commit(draws, resources, origin);
    const system = new LabelSystem({ glyphs: '', fontStack: '' }, scene);
    system.atlas.pages.set(78, new Map(decodeGlyphs(fixture('kye-glyph-19968-20223.pbf')).map(g => [g.id, g])));
    for (let i = 0; i < 60; i++) system.update(surfaces, camera, origin, view, 16, viewport, 1, i * 16, Infinity);
    expect(system.layouts).toBeGreaterThan(0);
    expect(system.placed).toBeGreaterThan(0);
    let committed = { ...system.basis.committed };
    expect(system.basis.error).toBe(0);

    // pan 跨瓦片边界：浮动原点跳到相邻瓦片中心，与已提交批次的基准不同。
    const moved = { ...view, center: { lng: view.center.lng + .02, lat: view.center.lat } };
    const movedOrigin = selectMapOrigin(moved.center, 15);
    expect(movedOrigin.meters.x).not.toBe(origin.meters.x);
    updateMapCamera(camera, moved, viewport, movedOrigin);

    let pending = false, committedNew = false, now = 6000;
    for (let i = 0; i < 40; i++) {
      now += 20;
      const before = system.layouts;
      system.update(surfaces, camera, movedOrigin, moved, 16, viewport, 1, now, Infinity);
      if (system.layouts === before) {
        pending = true;
        // 布局尚未提交：顶点数据仍是上一批，渲染基准必须保持为最近一次提交的基准，否则整批文字错位。
        expect(system.basis.committed).toEqual(committed);
      } else {
        committedNew = true;
        // 提交时顶点基准随顶点数据一起切换为本轮布局原点，并成为新的已提交基准。
        committed = { x: movedOrigin.meters.x, y: movedOrigin.meters.y };
        expect(system.basis.committed).toEqual(committed);
      }
      // 任意帧的渲染补偿都必须恰好还原当前浮动原点。
      expect(system.basis.error).toBe(0);
    }
    expect(pending).toBe(true);
    expect(committedNew).toBe(true);
  });
});
