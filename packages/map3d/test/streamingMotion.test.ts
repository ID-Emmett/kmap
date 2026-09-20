import { describe, expect, it, vi } from 'vitest';
import { Color, PerspectiveCamera, Scene, type WebGPURenderer } from 'three/webgpu';
import { StreamingEngine } from '../src/streaming/engine.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { childrenOf, keyOf, canonicalKey } from '../src/streaming/address.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import { resolveRenderCover } from '../src/streaming/renderCover.js';
import { updateProjection } from '../src/globe/projection.js';
import type { ViewState } from '../src/types.js';

vi.mock('../src/streaming/workers.js', () => ({ PaintWorkers: class {
  getStats() { return { active: 0, queued: 0 }; } dispose() {}
} }));

function setup() {
  const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#e6f4f3'), true);
  const engine = new StreamingEngine({ canvas: {} as HTMLCanvasElement, source: { id: 'motion', tiles: ['/{z}/{x}/{y}'], minZoom: 0, maxZoom: 17 }, layers: [] }, surfaces, {} as WebGPURenderer, '#dbdeff');
  vi.spyOn(engine.pipeline, 'pump').mockImplementation(() => {});
  const camera = new PerspectiveCamera(), viewport = { width: 512, height: 512 };
  let now = 0;
  const update = (view: ViewState) => {
    const origin = selectMapOrigin(view.center, Math.floor(view.zoom));
    const frame = updateMapCamera(camera, view, viewport, origin, true);
    updateProjection(scene, view, origin, true);
    engine.invalidate(); engine.update(camera, frame, origin, view, viewport, now += 20);
  };
  return { scene, surfaces, engine, update };
}

describe('运动期间的实际绘制覆盖', () => {
  it('平面与球面每帧均先绑定编号零，地面与模板内容写入分别控制', () => {
    const { scene, engine, update } = setup();
    for (const zoom of [15, 5, 4, 6]) {
      update({ center: { lng: 116.39, lat: 39.9 }, zoom, pitch: 40, bearing: 0 });
      const first = scene.children.find(o => o.renderOrder === -5)!;
      const material = (first as import('three/webgpu').Mesh).material as import('three/webgpu').MeshBasicNodeMaterial;
      expect(first.visible).toBe(true);
      expect(material.stencilWrite).toBe(true); expect(material.stencilRef).toBe(0);
      expect(material.stencilWriteMask).toBe(0); expect(material.depthWrite).toBe(false);
      expect(material.colorWrite).toBe(zoom >= 5.5);
    }
    engine.dispose();
  });
  it('相机跨整数缩放往返时使用同一滞回目标，越过门槛后整体切换', () => {
    const { engine, update } = setup();
    for (const [zoom, expected] of [[16.2, 16], [15.99, 16], [16.02, 16], [15.85, 16], [15.81, 15], [16.01, 15], [16.09, 16]]) {
      update({ center: { lng: 116.39, lat: 39.9 }, zoom: zoom!, pitch: 0, bearing: 0 });
      expect(new Set(engine.selection.leaves.map(a => a.z))).toEqual(new Set([expected]));
      expect(engine.tileZoom).toBe(expected);
    }
    engine.dispose();
  });
  it.each([false, true])('目标为空响应=%s 时，目标地址集合相同仍更新进入视锥的子瓦片', empty => {
    const { engine, surfaces, update } = setup();
    const view = { center: { lng: 116.39, lat: 39.9 }, zoom: 15.4, pitch: 55, bearing: 20 };
    update(view);
    for (const target of engine.selection.leaves) {
      if (empty) { const e = engine.entries.get(canonicalKey(target))!; e.state = 'ready'; e.empty = true; }
      for (const child of childrenOf(target)) {
      const e = engine.store.create(child, 'fallback', 0, 0)!;
      e.surface = surfaces.create({ width: 1, height: 1, close() {} } as ImageBitmap, child);
      e.state = 'ready'; engine.store.available.add(canonicalKey(child));
      }
    }
    // 资源到达通知触发一次基准提交。
    engine.pipeline.changed(); update(view);
    let keys = engine.selection.leaves.map(keyOf).sort().join('|');
    let initial = engine.patches.map(p => keyOf(p.cell)).sort().join('|');
    let verified = false;
    for (let n = 1; n <= 200; n++) {
      update({ ...view, center: { ...view.center, lng: view.center.lng + n * .00005 } });
      const nextKeys = engine.selection.leaves.map(keyOf).sort().join('|');
      const expected = resolveRenderCover(engine.selection.leaves, engine.store.available, 0, engine.selection.visible);
      const nextPatches = expected.patches.map(p => keyOf(p.cell)).sort().join('|');
      if (nextKeys === keys && nextPatches !== initial) {
        expect(engine.patches).toEqual(expected.patches); verified = true; break;
      }
      keys = nextKeys; initial = nextPatches;
    }
    expect(verified).toBe(true); engine.dispose();
  });
});
