import { describe, expect, it } from 'vitest';
import { Color, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGPURenderer, type Object3D } from 'three/webgpu';
import { DEFAULT_SKY_ZENITH_COLOR, MapSky, resolveSkyColors } from '../src/rendering/sky.js';
import { FOG_BAND_SCALE, fogCornerCoverage, fogDistanceAtScreen, fogDistances, fogRowForDistance } from '../src/streaming/fog.js';
import { MAP_CAMERA_HALF_FOV_TANGENT, updateMapCamera } from '../src/rendering/mapCamera.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { TileSurfaces } from '../src/streaming/surface.js';
import { GlyphAtlas } from '../src/labels/glyphAtlas.js';
import { LabelSurface } from '../src/labels/labelSurface.js';

interface ShaderBuilder { camera: PerspectiveCamera; scene: Scene; fogNode?: unknown; build(): unknown; vertexShader: string; fragmentShader: string }

const viewport = { width: 1280, height: 720 };
function cameraAt(pitch: number, bearing = 0) {
  const camera = new PerspectiveCamera();
  const view = { center: { lng: 116.39, lat: 39.9 }, zoom: 15, pitch, bearing };
  const origin = selectMapOrigin(view.center, 15);
  return { camera, view, origin, frame: updateMapCamera(camera, view, viewport, origin) };
}

describe('天空背景与远景雾连续融合', () => {
  it('地平线色取 fogColor ?? backgroundColor，天顶色省略时使用 SDK 蓝色默认值', () => {
    expect(resolveSkyColors({ backgroundColor: '#101010', fogColor: '#202020' })).toEqual({ horizon: '#202020', zenith: DEFAULT_SKY_ZENITH_COLOR });
    expect(resolveSkyColors({ backgroundColor: '#101010' })).toEqual({ horizon: '#101010', zenith: DEFAULT_SKY_ZENITH_COLOR });
    expect(resolveSkyColors({ backgroundColor: 0x123456, skyZenithColor: 0xabcdef })).toEqual({ horizon: 0x123456, zenith: 0xabcdef });
    expect(new Color(DEFAULT_SKY_ZENITH_COLOR).getHexString()).not.toBe(new Color('#ffffff').getHexString());
  });

  it('雾随俯仰角连续进入视野：低倾角保持可视范围之外的远景雾，75° 收近到顶部 40%', () => {
    // 20° 以下起止距离都在屏幕最远可见距离之外，屏幕内不出现雾。
    for (const pitch of [0, 10, 20]) {
      const { frame } = cameraAt(pitch);
      expect(fogDistances(frame, pitch).start).toBeGreaterThan(fogDistanceAtScreen(frame, pitch, 0));
    }
    // 起止距离随俯仰角单调收近，连续变化，不存在整屏突然出现雾的角度。
    for (let pitch = 0; pitch < 75; pitch += 5) {
      const near = fogDistances(cameraAt(pitch).frame, pitch); const far = fogDistances(cameraAt(pitch + 5).frame, pitch + 5);
      expect(near.end / cameraAt(pitch).frame.distance).toBeGreaterThanOrEqual(far.end / cameraAt(pitch + 5).frame.distance);
      expect(near.start / cameraAt(pitch).frame.distance).toBeGreaterThanOrEqual(far.start / cameraAt(pitch + 5).frame.distance);
    }
    const high = cameraAt(75);
    const selected = fogDistances(high.frame, 75);
    expect(selected.end / high.frame.distance).toBeCloseTo(1.4524, 3);
    // 过渡带按 FOG_BAND_SCALE 收窄：完全入雾位置不变，开始入雾向它靠近。
    expect(selected.wide).toBeLessThan(selected.start); expect(selected.start).toBeLessThan(selected.end);
    expect(selected.end - selected.start).toBeCloseTo((selected.end - selected.wide) * FOG_BAND_SCALE, 6);
    expect(FOG_BAND_SCALE).toBeGreaterThan(0); expect(FOG_BAND_SCALE).toBeLessThan(1);
  });

  it('雾带起点早于终点，75° 完全入雾距离等于屏幕顶部 40% 行的真实地面距离', () => {
    const { camera, frame } = cameraAt(75);
    const selected = fogDistances(frame, 75);
    expect(selected.start).toBeLessThan(selected.end);
    expect(selected.end).toBeCloseTo(fogDistanceAtScreen(frame, 75, .4), 6);
    const ray = new Vector3(0, .2, .5).unproject(camera).sub(camera.position).normalize();
    expect(selected.end).toBeCloseTo(-camera.position.y / ray.y, 5);
  });

  it('全程起止距离有序，低俯仰角雾带在可视范围之外', () => {
    for (let pitch = 0; pitch <= 75; pitch += 1) {
      const { frame } = cameraAt(pitch);
      const fog = fogDistances(frame, pitch);
      expect(Number.isFinite(fog.start)).toBe(true); expect(Number.isFinite(fog.end)).toBe(true);
      expect(fog.start).toBeLessThan(fog.end);
      // 屏幕最远可见行；低俯仰角时开始入雾仍应位于其后，正俯视下不能出现反转雾带。
      const farthestVisible = Math.max(fogDistanceAtScreen(frame, pitch, 0), fogDistanceAtScreen(frame, pitch, 1));
      if (pitch <= 16) expect(fog.start).toBeGreaterThan(farthestVisible);
    }
    const topDown = cameraAt(0);
    expect(fogDistances(topDown.frame, 0).start).toBeGreaterThan(topDown.frame.distance * 10);
  });

  it('天空底边取完全入雾行：低倾角整行在屏幕外，75° 位于顶部 40% 并随视角移动', () => {
    const skyAt = (pitch: number, bearing = 25) => {
      const { camera, frame } = cameraAt(pitch, bearing);
      const sky = new MapSky('#dbdeff');
      const fog = fogDistances(frame, pitch);
      const row = fogRowForDistance(frame, pitch, fog.end);
      sky.update(camera, fog.start, fog.end, row);
      return { sky, state: sky.getState(), fog, row, camera };
    };
    // 内容边界尚未进入视野：屏幕内没有天空。
    for (const pitch of [0, 20, 40]) expect(skyAt(pitch).state.boundary).toBe(0);
    // 视野出现内容边界后，底边随俯仰角单调下移，75° 位于屏幕顶部 40%。
    let previous = 0;
    for (const pitch of [55, 60, 70, 75]) {
      const { state } = skyAt(pitch);
      expect(state.boundary).toBeGreaterThan(previous); expect(state.boundary).toBeLessThan(1); previous = state.boundary;
    }
    expect(skyAt(75).state.boundary).toBeCloseTo(.4, 2);
    const moved = skyAt(75, 200).state;
    expect(moved.boundary).toBeCloseTo(.4, 2);
    const { sky, fog, camera, row } = skyAt(60);
    expect(sky.getState().fogStart).toBeCloseTo(fog.start, 6); expect(sky.getState().fogEnd).toBeCloseTo(fog.end, 6);
    expect(sky.getState().boundary).toBeCloseTo(row, 6);
    expect(sky.fogCenter.value.x).toBeCloseTo(camera.position.x, 6);
    expect(sky.fogCenter.value.y).toBeCloseTo(camera.position.y, 6);
  });

  it('CPU 行换算与着色器行换算互为反函数', () => {
    for (const pitch of [0, 20, 40, 60, 75]) {
      const { frame } = cameraAt(pitch);
      const selected = fogDistances(frame, pitch), radians = Math.PI / 180;
      // 着色器：屏幕行 → 相机系垂直正切 → 该行中心列的地面距离。
      const height = frame.distance * Math.cos(pitch * radians);
      const axisSin = Math.cos(pitch * radians), axisCos = Math.sin(pitch * radians);
      for (const distance of [selected.wide, selected.start, selected.end]) {
        const row = fogRowForDistance(frame, pitch, distance);
        if (!(row > -1)) continue;
        const tangent = (1 - 2 * row) * MAP_CAMERA_HALF_FOV_TANGENT;
        const shaded = height * Math.hypot(1, tangent) / Math.max(axisSin - axisCos * tangent, 1e-12);
        expect(shaded).toBeCloseTo(distance, 3);
      }
    }
  });

  it('选片放大系数覆盖同行边缘与中心的最大地面距离比，且随宽高比单调', () => {
    const wide = { width: 2560, height: 1305 }, tall = { width: 720, height: 1280 };
    expect(fogCornerCoverage(wide)).toBeGreaterThan(fogCornerCoverage(tall));
    expect(fogCornerCoverage({ width: 1280, height: 720 })).toBeCloseTo(1.2417, 3);
    expect(fogCornerCoverage(tall)).toBeCloseTo(1.0824, 3);
    // 水平半视场正切；同一屏幕行上边缘与中心的地面距离比在该行取最大。
    const halfWidth = MAP_CAMERA_HALF_FOV_TANGENT * (wide.width / wide.height);
    for (const pitch of [0, 30, 60, 75]) {
      const { frame } = cameraAt(pitch); const radians = Math.PI / 180;
      const height = frame.distance * Math.cos(pitch * radians);
      const axisSin = Math.cos(pitch * radians), axisCos = Math.sin(pitch * radians);
      const distanceAt = (ndcY: number, ndcX: number) => height * Math.hypot(1, ndcX * halfWidth, ndcY * MAP_CAMERA_HALF_FOV_TANGENT)
        / Math.max(axisSin - axisCos * ndcY * MAP_CAMERA_HALF_FOV_TANGENT, 1e-12);
      for (const ndcY of [-1, -0.5, 0, 0.5, 1]) {
        const center = distanceAt(ndcY, 0);
        if (!(center > 0) || !Number.isFinite(center)) continue;
        expect(distanceAt(ndcY, 1) / center).toBeLessThanOrEqual(fogCornerCoverage(wide) + 1e-9);
      }
    }
  });

  it('俯视不显示天空，地面批次与雾完成距离保持同一覆盖范围', () => {
    const topDown = cameraAt(0);
    const sky = new MapSky('#dbdeff');
    const topFog = fogDistances(topDown.frame, 0);
    sky.update(topDown.camera, topFog.start, topFog.end, fogRowForDistance(topDown.frame, 0, topFog.end));
    expect(sky.getState().boundary).toBeLessThanOrEqual(0);
    const surfaces = new TileSurfaces(new Scene(), new Color('#e6f4f3'), sky);
    const tilted = cameraAt(60);
    const fog = fogDistances(tilted.frame, 60);
    sky.update(tilted.camera, fog.start, fog.end, fogRowForDistance(tilted.frame, 60, fog.end));
    // 地面底板半径取雾完成距离与选片半径的较大者，保证覆盖实际加载范围。
    surfaces.update(tilted.origin, 15, 15, fog.end);
    const ground = surfaces.scene.children.find(child => child.renderOrder === -5) as Mesh;
    expect(ground.position.x).toBeCloseTo(sky.fogCenter.value.x, 6);
    expect(ground.position.z).toBeCloseTo(sky.fogCenter.value.z, 6);
    expect(ground.scale.x).toBeCloseTo(fog.end * 2, 6);
    surfaces.dispose();
  });

  it('主题切换即时同步地平线色与天顶色，远景文字随雾收敛', () => {
    const sky = new MapSky('#dbdeff');
    expect(sky.getState()).toMatchObject({ horizon: '#dbdeff', zenith: DEFAULT_SKY_ZENITH_COLOR });
    sky.setColors('#132030', '#1d4468');
    expect(sky.getState()).toMatchObject({ horizon: '#132030', zenith: '#1d4468' });
    const atlas = new GlyphAtlas({ glyphs: '', fontStack: '' });
    const labels = new LabelSurface(atlas);
    expect(labels.mesh.material.fog).toBe(true); expect(labels.mesh.material.transparent).toBe(true);
    labels.dispose(); atlas.dispose();
  });

  it.each(['webgpu', 'webgl2'] as const)('%s 的天空背景与雾节点生成完整着色器', backend => {
    const canvas = { width: 800, height: 600, style: {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
    const renderer = new WebGPURenderer({ canvas, forceWebGL: backend === 'webgl2' });
    renderer.hasFeature = () => false;
    Object.assign(renderer.backend, { capabilities: { getUniformBufferLimit: () => 65536 }, extensions: { has: () => false } });
    const sky = new MapSky('#dbdeff');
    const scene = new Scene();
    const background = new MeshBasicNodeMaterial(); background.colorNode = sky.backgroundNode;
    const fogged = new MeshBasicNodeMaterial(); fogged.colorNode = sky.colorNode;
    for (const material of [background, fogged]) {
      const mesh = new Mesh(new PlaneGeometry(), material);
      const backendBuilder = renderer.backend as typeof renderer.backend & { createNodeBuilder(object: Object3D, renderer: WebGPURenderer): ShaderBuilder };
      const builder = backendBuilder.createNodeBuilder(mesh, renderer);
      builder.camera = new PerspectiveCamera(); builder.scene = scene; builder.fogNode = sky.fogNode; builder.build();
      expect(builder.vertexShader).toContain('main'); expect(builder.fragmentShader).toContain('main');
      material.dispose();
    }
  });
});
