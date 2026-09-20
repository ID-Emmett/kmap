import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { OverlayCache } from '../src/streaming/overlayCache.js';
import { decodeTileSources, packTileSources } from '../src/streaming/tileSources.js';
import { buildFills } from '../src/streaming/fills.js';
import { sampleFill } from '../src/streaming/fillSample.js';
import { buildLabels } from '../src/labels/candidates.js';
import { decodeGlyphs } from '../src/labels/glyphs.js';
import { GlyphAtlas } from '../src/labels/glyphAtlas.js';
import { CollisionGrid, overlaps } from '../src/labels/collision.js';
import { LabelSystem, ownsAnchor } from '../src/labels/labelSystem.js';
import { decodeVectorTile } from '../src/streaming/paint.js';
import { globeBlend, GLOBE_END, GLOBE_START, updateGlobeCamera } from '../src/globe/globeCamera.js';
import type { MapLayerOptions } from '../src/types.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { updateMapCamera } from '../src/rendering/mapCamera.js';
import type { LabelCandidate } from '../src/labels/candidates.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('海洋补充、文字与地球数据契约', () => {
  it('截图 z7/108/54 的海面和岛屿孔洞在 1024 个采样点符合真实专用源', () => {
    const source = { tiles: [], minZoom: 7, maxZoom: 7, sourceLayer: 'water', targetLayer: 'ocean' };
    const packed = packTileSources([new ArrayBuffer(0), fixture('kye-ocean-z7-108-54.mvt').buffer]);
    const layers: MapLayerOptions[] = [{ type: 'fill', id: 'ocean', sourceLayer: 'ocean', paint: { color: '#A9D7E8' } }];
    const address = { z: 7, x: 108, y: 54 };
    const data = buildFills(decodeTileSources(packed, address, [source]), layers);
    expect(data.features).toBe(797);
    const layer = decodeVectorTile(fixture('kye-ocean-z7-108-54.mvt')).layers.water!;
    const rings = Array.from({ length: layer.length }, (_, i) => layer.feature(i).loadGeometry()); let water = 0;
    const inside = (ring: { x: number; y: number }[], x: number, y: number): boolean => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!, b = ring[j]!;
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const expected = rings.some(rs => rs.reduce((hit, r) => inside(r, (x + .5) * 128, (y + .5) * 128) ? !hit : hit, false));
      expect(!!sampleFill(data, (x + .5) / 32 - .5, (y + .5) / 32 - .5, 7), `海面采样 ${x},${y}`).toBe(expected);
      if (expected) water++;
    }
    expect(water).toBe(960);
    const child = { z: 17, x: address.x * 1024 + 512, y: address.y * 1024 + 512 };
    const clipped = buildFills(decodeTileSources(packed, child, [source]), layers);
    expect(clipped.features).toBeLessThan(10); expect(sampleFill(clipped, 0, 0, 17)).toBeDefined();
    const baseSource = { ...source, minZoom: 0, maxZoom: 6, targetLayer: 'ocean_base', onlyWhenPrimaryEmpty: true };
    const combined = packTileSources([new ArrayBuffer(0), fixture('kye-water-z6-54-27.mvt').buffer, fixture('kye-ocean-z7-108-54.mvt').buffer]);
    const full = buildFills(decodeTileSources(combined, address, [baseSource, source]), [{ ...layers[0]!, type: 'fill', id: 'base', sourceLayer: 'ocean_base', paint: { color: '#A9D7E8' } }, ...layers]);
    // 专用详细源的东南覆盖边缘由真实祖先海洋填充。
    expect(sampleFill(full, 31.5 / 32 - .5, 31.5 / 32 - .5, 7)).toBeDefined();
    expect(sampleFill(full, 31.5 / 32 - .5, 10.5 / 32 - .5, 7)).toBeDefined();
  });
  it('补充请求由租约共享，一位调用方取消时另一位继续，并以字节上限回收', async () => {
    const cache = new OverlayCache(8, 2), a = new AbortController(), b = new AbortController();
    let complete!: (buffer: ArrayBuffer) => void;
    const loader = vi.fn(() => new Promise<ArrayBuffer>(resolve => { complete = resolve; }));
    const first = cache.read('same', a.signal, loader), second = cache.read('same', b.signal, loader);
    const rejected = expect(first).rejects.toBe('cancel'); a.abort('cancel'); complete(new ArrayBuffer(8));
    await rejected; expect((await second).byteLength).toBe(8); expect(loader).toHaveBeenCalledOnce();
    await cache.read('second', b.signal, async () => new ArrayBuffer(8)); expect(cache.bytes).toBe(8);
    cache.dispose(); expect(cache.bytes).toBe(0);
  });
  it('补充请求的最后一位调用方退出会取消网络，错误响应可重试', async () => {
    const cache = new OverlayCache(), controller = new AbortController(); let aborted = false;
    const read = cache.read('test', controller.signal, signal => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); })));
    const check = expect(read).rejects.toBe('cancel'); controller.abort('cancel'); await check; expect(aborted).toBe(true);
    expect((await cache.read('test', new AbortController().signal, async () => new ArrayBuffer(4))).byteLength).toBe(4); cache.dispose();
  });
  it('真实 CJK range 解码 SDF 和度量，字体并发缓存复用且 atlas 释放', async () => {
    const bytes = fixture('kye-glyph-19968-20223.pbf'), glyphs = decodeGlyphs(bytes);
    expect(glyphs.length).toBeGreaterThan(240);
    const glyph = glyphs.find(g => g.id === '中'.codePointAt(0))!;
    expect(glyph.advance).toBeGreaterThan(0); expect(glyph.bitmap.length).toBe((glyph.width + 6) * (glyph.height + 6));
    const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal('fetch', fetcher);
    const atlas = new GlyphAtlas({ glyphs: 'https://font.test/{fontstack}/{range}.pbf', fontStack: 'Microsoft YaHei Regular' });
    atlas.ensure(['中'.codePointAt(0)!]); atlas.ensure(['中'.codePointAt(0)!]);
    await vi.waitFor(() => expect(atlas.glyphs.has(glyph.id)).toBe(true));
    expect(fetcher).toHaveBeenCalledOnce(); expect(atlas.errors).toBe(0); expect(atlas.texture.image.data!.length).toBe(2048 ** 2);
    atlas.dispose(); expect(atlas.glyphs.size).toBe(0); expect(atlas.pages.size).toBe(0);
  });
  it('中文道路和 POI 标签来自真实瓦片，批次上限和有效名称约束明确', () => {
    const tile = decodeVectorTile(fixture('kye-main-z15-26978-12416.mvt'));
    const labels = buildLabels(tile, [
      { type: 'symbol', id: 'poi', sourceLayer: 'poi_label', layout: { textFields: ['short_name', 'name'], priority: 100 }, paint: {} },
      { type: 'symbol', id: 'road', sourceLayer: 'road', layout: { placement: 'line', priority: 50 }, paint: {} },
    ]);
    expect(labels.length).toBeGreaterThan(10); expect(labels.length).toBeLessThanOrEqual(256);
    expect(labels.some(l => /[\u3400-\u9fff]/.test(l.text))).toBe(true); expect(labels.some(l => l.line)).toBe(true);
    expect(labels.every(l => l.text.length <= 48 && [l.x, l.y, l.endX, l.endY].every(Number.isFinite))).toBe(true);
  });
  it('碰撞网格跨单元格命中、互斥区域的边缘锚点仅归一个子格', () => {
    const grid = new CollisionGrid(); const box = { left: 55, top: 60, right: 130, bottom: 100 }; grid.insert(box);
    expect(grid.collides({ left: 128, top: 90, right: 150, bottom: 110 })).toBe(true);
    expect(grid.collides({ left: 130, top: 60, right: 160, bottom: 100 })).toBe(false);
    expect(overlaps(box, box)).toBe(true);
    const a = { z: 7, x: 108, y: 54 };
    expect(ownsAnchor(a, [{ z: 8, x: 216, y: 108 }], .5, .25)).toBe(false);
    expect(ownsAnchor(a, [{ z: 8, x: 217, y: 108 }], .5, .25)).toBe(true);
  });
  it('文字布局保留优先标签、静止复用、浮动原点更新与 GPU 资源回收', () => {
    const scene = new Scene(), surfaces = new TileSurfaces(scene, new Color('#fff'));
    const address = { z: 15, x: 26978, y: 12416 };
    const view = { center: { lng: 116.3946533203125, lat: 39.90552253972854 }, zoom: 15.2, bearing: 0, pitch: 0 };
    const origin = selectMapOrigin(view.center, 15), camera = new PerspectiveCamera(), viewport = { width: 1280, height: 720 };
    updateMapCamera(camera, view, viewport, origin);
    const candidate: LabelCandidate = { text: '中', x: .5, y: .5, endX: .5, endY: .5, line: false, key: 'a', priority: 0,
      minZoom: 16, maxZoom: 25, size: 16, color: '#333', haloColor: '#fff', haloWidth: 1, };
    const resource = surfaces.create({ width: 1, height: 1, close() {} } as ImageBitmap, address, undefined, undefined, undefined, [candidate, { ...candidate, key: 'b', priority: 100 }]);
    surfaces.commit([{ cell: address, source: address, key: '15/26978/12416' }], new Map([['15/26978/12416', { surface: resource }]]), origin);
    const system = new LabelSystem({ glyphs: '', fontStack: '' }, scene);
    system.atlas.pages.set(78, new Map(decodeGlyphs(fixture('kye-glyph-19968-20223.pbf')).map(g => [g.id, g])));
    system.update(surfaces, camera, origin, view, 16, viewport, 1, 0, Infinity);
    expect(system.placed).toBe(1); expect(system.surface.count).toBe(1);
    system.update(surfaces, camera, origin, view, 16, viewport, 1, 100, Infinity);
    const layouts = system.layouts;
    const movedOrigin = { ...origin, meters: { x: origin.meters.x + 100, y: origin.meters.y } };
    updateMapCamera(camera, view, viewport, movedOrigin);
    system.update(surfaces, camera, movedOrigin, view, 16, viewport, 1, 200, Infinity);
    expect(system.layouts).toBe(layouts); expect(system.surface.origin.value.x).toBe(100);
    const disposed = vi.fn(); system.surface.mesh.geometry.addEventListener('dispose', disposed);
    system.dispose(); surfaces.dispose(); surfaces.release(resource); expect(disposed).toHaveBeenCalledOnce(); expect(scene.children).toHaveLength(0);
  });
  it.each([[1280, 720], [720, 1280], [2560, 1305]])('最低缩放完整球面适配 %s×%s，任意中心保持朝向', (width, height) => {
    const camera = new PerspectiveCamera(), viewport = { width, height };
    for (const center of [{ lng: 116, lat: 40 }, { lng: -170, lat: -45 }, { lng: 0, lat: 85 }]) {
      const view = { center, zoom: 0, bearing: 38, pitch: 75 }; updateGlobeCamera(camera, view, viewport);
      for (let j = 0; j < 60; j++) for (let k = 0; k < 30; k++) {
        const lng = j / 60 * Math.PI * 2, lat = (k / 29 - .5) * Math.PI;
        const p = new Vector3(Math.cos(lat) * Math.sin(lng), Math.sin(lat), Math.cos(lat) * Math.cos(lng)).project(camera);
        expect(Math.abs(p.x)).toBeLessThan(.85); expect(Math.abs(p.y)).toBeLessThan(.85);
      }
    }
    expect(globeBlend(0)).toBe(0); expect(globeBlend(GLOBE_START)).toBe(0); expect(globeBlend(GLOBE_END)).toBe(1);
    expect(globeBlend((GLOBE_START + GLOBE_END) / 2)).toBeCloseTo(.5);
  });
});
