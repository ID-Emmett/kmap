import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Points, PointsNodeMaterial, QuadMesh, RenderTarget, RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace, Texture, type WebGPURenderer } from 'three/webgpu';
import { float, max, normalView, positionViewDirection, texture, uniform, vec3, vec4 } from 'three/tsl';
import type { Map3DOptions, ViewportSize, ViewState } from '../types.js';
import { globeBlend, updateGlobeCamera } from './globeCamera.js';
import { requestUrl } from '../streaming/address.js';

/** 低缩放地球复用 KYE 根瓦片，空间背景与大气分别通过共享几何合批。 */
export class GlobeView {
  readonly scene = new Scene(); readonly camera = new PerspectiveCamera();
  private readonly material = new MeshBasicNodeMaterial({ color: '#BDCDAF' });
  private readonly globe: Mesh<BufferGeometry, MeshBasicNodeMaterial>;
  private readonly atmosphere: Mesh<SphereGeometry, MeshBasicNodeMaterial>;
  private readonly stars: Points<BufferGeometry, PointsNodeMaterial>;
  private readonly blend = uniform(0); private target: RenderTarget | undefined;
  private quad: QuadMesh | undefined; private map: Texture | undefined; private bitmap: ImageBitmap | undefined;
  private worker: Worker | undefined; private controller: AbortController | undefined; private disposed = false; private retryAt = 0;
  ready = false; errors = 0;
  constructor(readonly options: Map3DOptions) {
    this.scene.background = new Color('#050B18');
    const geometry = new SphereGeometry(1, 160, 80);
    // SphereGeometry 的经线方向映射到 XYZ Mercator，极区使用极点行。
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      const lng = Math.atan2(positions.getX(i), positions.getZ(i));
      const lat = Math.asin(Math.max(-.996272, Math.min(.996272, positions.getY(i))));
      uv.setXY(i, (lng / Math.PI + 1) / 2, (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2);
    }
    // 经线接缝上的 U 保持连续，三角形避免横跨整个纹理。
    const nonIndexed = geometry.toNonIndexed(); geometry.dispose();
    const coords = nonIndexed.getAttribute('uv');
    for (let i = 0; i < coords.count; i += 3) {
      const values = [coords.getX(i), coords.getX(i + 1), coords.getX(i + 2)];
      if (Math.max(...values) - Math.min(...values) > .5) for (let j = 0; j < 3; j++) if (values[j]! < .5) coords.setX(i + j, values[j]! + 1);
    }
    this.material.colorNode = vec3(.95, 1, 1).mul(max(normalView.dot(vec3(-.3, .4, 1).normalize()), 0).mul(.25).add(.75));
    this.globe = new Mesh(nonIndexed, this.material); this.scene.add(this.globe);
    const atmosphereMaterial = new MeshBasicNodeMaterial({ transparent: true, side: BackSide, depthWrite: false, blending: AdditiveBlending });
    atmosphereMaterial.colorNode = vec4(.12, .3, .5, float(1).sub(normalView.dot(positionViewDirection).abs()).pow(3).mul(.45));
    this.atmosphere = new Mesh(new SphereGeometry(1.025, 80, 40), atmosphereMaterial); this.scene.add(this.atmosphere);
    const starGeometry = new BufferGeometry(), starPositions = new Float32Array(700 * 3); let seed = 83173;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < 700; i++) {
      const y = random() * 2 - 1, angle = random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      starPositions.set([r * Math.cos(angle) * 40, y * 40, r * Math.sin(angle) * 40], i * 3);
    }
    starGeometry.setAttribute('position', new BufferAttribute(starPositions, 3));
    this.stars = new Points(starGeometry, new PointsNodeMaterial({ color: '#9EB3CE', size: 1.3, sizeAttenuation: false, depthWrite: false })); this.scene.add(this.stars);
  }
  update(view: ViewState, viewport: ViewportSize): void {
    updateGlobeCamera(this.camera, view, viewport); this.blend.value = 1 - globeBlend(view.zoom);
    if (!this.ready && !this.controller && this.errors < 3 && performance.now() >= this.retryAt) void this.load();
  }
  private async load(): Promise<void> {
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(requestUrl({ z: 0, x: 0, y: 0 }, this.options.source.tiles), { signal: controller.signal });
      if (!response.ok || response.status === 204) throw new Error(`Globe HTTP ${response.status}`);
      const buffer = await response.arrayBuffer(); if (buffer.byteLength > 2 * 1024 * 1024) throw new Error('地球根瓦片超出 2 MiB。');
      if (this.disposed) return;
      const worker = new Worker(new URL('./globe.worker.ts', import.meta.url), { type: 'module' }); this.worker = worker;
      const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('地球纹理生成超时。')), 10000);
        worker.onmessage = (event: MessageEvent<{ bitmap?: ImageBitmap; error?: string }>) => { clearTimeout(timer); if (event.data.bitmap) resolve(event.data.bitmap); else reject(new Error(event.data.error)); };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('地球加载已取消。')); }, { once: true });
        worker.postMessage(buffer, [buffer]);
      });
      if (this.disposed) { bitmap.close(); return; }
      this.bitmap = bitmap; this.map = new Texture(bitmap); this.map.flipY = false; this.map.colorSpace = SRGBColorSpace; this.map.needsUpdate = true;
      this.map.wrapS = RepeatWrapping;
      this.material.colorNode = texture(this.map).rgb.mul(max(normalView.dot(vec3(-.3, .4, 1).normalize()), 0).mul(.25).add(.75)); this.material.needsUpdate = true; this.ready = true;
    } catch { if (!this.disposed) { this.errors++; this.retryAt = performance.now() + 2000; } }
    finally { clearTimeout(timeout); this.worker?.terminate(); this.worker = undefined; if (this.controller === controller) this.controller = undefined; }
  }
  render(renderer: WebGPURenderer, mapScene: Scene, mapCamera: PerspectiveCamera, viewport: ViewportSize): void {
    if (this.blend.value >= 1) { this.releaseTarget(); renderer.render(this.scene, this.camera); return; }
    const width = Math.round(viewport.width * (viewport.pixelRatio ?? 1)), height = Math.round(viewport.height * (viewport.pixelRatio ?? 1));
    if (!this.target) {
      this.target = new RenderTarget(width, height);
      const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
      material.colorNode = vec4(texture(this.target.texture).rgb, this.blend); this.quad = new QuadMesh(material);
    }
    this.target.setSize(width, height);
    renderer.setRenderTarget(this.target); renderer.render(this.scene, this.camera); renderer.setRenderTarget(null);
    renderer.render(mapScene, mapCamera); const autoClear = renderer.autoClear; renderer.autoClear = false; this.quad!.render(renderer); renderer.autoClear = autoClear;
  }
  releaseTarget(): void { this.target?.dispose(); this.target = undefined; if (this.quad) (this.quad.material as MeshBasicNodeMaterial).dispose(); this.quad = undefined; }
  dispose(): void {
    this.disposed = true; this.controller?.abort(); this.worker?.terminate(); this.releaseTarget();
    for (const object of [this.globe, this.atmosphere, this.stars]) { object.geometry.dispose(); object.material.dispose(); }
    this.map?.dispose(); this.bitmap?.close();
  }
}
