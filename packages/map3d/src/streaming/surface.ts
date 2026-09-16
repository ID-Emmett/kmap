import { AlwaysStencilFunc, Color, Mesh, MeshBasicNodeMaterial, ReplaceStencilOp, SRGBColorSpace, Texture, Vector3, type Scene } from 'three/webgpu';
import { fog, positionLocal, positionWorld, renderGroup, smoothstep, uniform } from 'three/tsl';
import type { MapOrigin } from '../spatial/types.js';
import { keyOf, tileBounds, type Address } from './address.js';
import { createLineSurface } from './lineSurface.js';
import { lineBytes, linePixelScale, type LineData } from './lines.js';
import { coverSources, type CoverPatch } from './renderCover.js';
import { PatchGeometry } from './patchGeometry.js';

interface DrawInstance { mesh: Mesh<PatchGeometry, MeshBasicNodeMaterial>; lines: undefined | ReturnType<typeof createLineSurface>; address: Address; resource: Surface; primary: boolean }
/** 一个来源对应一个区域面批次；颜色绘制同时写入道路使用的 stencil 归属。 */
export class TileSurfaces {
  readonly fogCenter = uniform(new Vector3()).setGroup(renderGroup);
  readonly fogStart = uniform(1).setGroup(renderGroup); readonly fogEnd = uniform(2).setGroup(renderGroup); readonly fogColor;
  readonly instances = new Map<string, DrawInstance>();
  private readonly resources = new Set<{ mesh: Mesh<PatchGeometry, MeshBasicNodeMaterial> }>();
  private originX = NaN; private originY = NaN;
  get geometryBytes(): number {
    let bytes = 0;
    for (const r of this.resources) bytes += r.mesh.geometry.bytes;
    for (const i of this.instances.values()) if (!i.primary) bytes += i.mesh.geometry.bytes;
    return bytes;
  }
  constructor(readonly scene: Scene, background: Color) {
    this.fogColor = uniform(background).setGroup(renderGroup);
    scene.fogNode = fog(this.fogColor, smoothstep(this.fogStart, this.fogEnd, positionWorld.sub(this.fogCenter).length()));
  }
  create(bitmap: ImageBitmap, address: Address, data?: LineData) {
    const map = new Texture(bitmap); map.colorSpace = SRGBColorSpace;
    map.flipY = false; map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true;
    const material = new MeshBasicNodeMaterial({ map, depthTest: false, depthWrite: false,
      stencilWrite: false, stencilWriteMask: 255, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp });
    material.positionNode = positionLocal;
    const geometry = new PatchGeometry(); geometry.update(address, [address]);
    const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; mesh.visible = false; mesh.matrixAutoUpdate = false;
    const lines = data?.segments.length ? createLineSurface(data) : undefined;
    if (lines) { lines.mesh.renderOrder = 1; mesh.add(lines.mesh); }
    const resource = { mesh, map, bitmap, lines, bytes: Math.ceil(bitmap.width * bitmap.height * 4 * 4 / 3) + lineBytes(data), cpuBytes: bitmap.width * bitmap.height * 4 + lineBytes(data) };
    this.resources.add(resource); return resource;
  }
  commit(patches: readonly CoverPatch[], resources: ReadonlyMap<string, { surface?: Surface }>, origin: MapOrigin): void {
    const draws = coverSources(patches); const active = new Set(draws.map(d => keyOf(d.address)));
    for (const [id, i] of this.instances) if (!active.has(id)) {
      this.scene.remove(i.mesh); i.mesh.visible = false;
      if (!i.primary) { i.mesh.geometry.dispose(); i.mesh.material.dispose(); i.lines?.mesh.material.dispose(); }
      this.instances.delete(id);
    }
    let stencil = 0;
    for (const draw of draws) {
      const resource = resources.get(draw.key)?.surface; if (!resource) continue;
      const id = keyOf(draw.address);
      const clipped = !(draw.cells.length === 1 && keyOf(draw.cells[0]!) === id);
      let instance = this.instances.get(id);
      if (!instance) {
        const primary = ![...this.instances.values()].some(i => i.resource === resource && i.primary);
        const mesh = primary ? resource.mesh : new Mesh(new PatchGeometry(), resource.mesh.material.clone());
        let lines = primary ? resource.lines : undefined;
        if (!primary && resource.lines) {
          const lineMesh = new Mesh(resource.lines.mesh.geometry, resource.lines.mesh.material.clone());
          lineMesh.frustumCulled = false; lineMesh.renderOrder = 1;
          const state = { pixelScale: { value: 1 / 256 }, viewZoom: { value: 15 } };
          lineMesh.userData.lineState = state; mesh.add(lineMesh); lines = { ...resource.lines, mesh: lineMesh, ...state };
        }
        instance = { mesh, lines, address: draw.address, resource, primary };
        mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; this.instances.set(id, instance); this.scene.add(mesh);
      }
      const stencilClip = clipped && !!instance.lines;
      if (stencilClip && ++stencil > 255) throw new Error('部分区域线来源超过 stencil 容量。');
      instance.mesh.geometry.update(draw.address, draw.cells);
      instance.mesh.visible = true; instance.mesh.material.stencilRef = stencil; instance.mesh.material.stencilWrite = stencilClip;
      if (instance.lines) { instance.lines.mesh.material.stencilRef = stencil; instance.lines.mesh.material.stencilWrite = stencilClip; }
      this.place(instance.mesh, draw.address, origin);
    }
    this.originX = origin.meters.x; this.originY = origin.meters.y;
  }
  update(origin: MapOrigin, viewZoom: number): void {
    const moved = origin.meters.x !== this.originX || origin.meters.y !== this.originY;
    for (const i of this.instances.values()) {
      if (moved) this.place(i.mesh, i.address, origin);
      if (i.lines) { i.lines.pixelScale.value = linePixelScale(i.address.z, viewZoom); i.lines.viewZoom.value = viewZoom; }
    }
    this.originX = origin.meters.x; this.originY = origin.meters.y;
  }
  place(mesh: Mesh, address: Address, origin: MapOrigin): void {
    const b = tileBounds(address); mesh.position.set(b.west + b.span / 2 - origin.meters.x, 0, origin.meters.y - b.north + b.span / 2);
    mesh.scale.set(b.span, 1, b.span); mesh.updateMatrix();
  }
  release(surface: Surface): void {
    this.resources.delete(surface); surface.mesh.geometry.dispose();
    surface.lines?.mesh.geometry.dispose(); surface.lines?.mesh.material.dispose();
    this.scene.remove(surface.mesh); surface.mesh.material.dispose(); surface.map.dispose(); surface.bitmap.close();
  }
  dispose(): void {
    for (const i of this.instances.values()) {
      this.scene.remove(i.mesh);
      if (!i.primary) { i.mesh.geometry.dispose(); i.mesh.material.dispose(); i.lines?.mesh.material.dispose(); }
    }
    this.instances.clear();
  }
}
export type Surface = ReturnType<TileSurfaces['create']>;

