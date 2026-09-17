import { bindingBytes, MapPalette } from '../style/palette.js';
import { mapVertex, mapFacing, mapWorldPosition } from '../globe/projection.js';
import { surfaceStateBytes } from './surfaceBytes.js';
import { AlwaysStencilFunc, Color, Mesh, MeshBasicNodeMaterial, ReplaceStencilOp, SRGBColorSpace, Texture, Vector3, type Scene } from 'three/webgpu';
import { Fn, float, fog, max, positionLocal, positionWorld, renderGroup, smoothstep, uniform } from 'three/tsl';
import type { MapOrigin } from '../spatial/types.js';
import { keyOf, tileBounds, type Address } from './address.js';
import { createLineSurface } from './lineSurface.js';
import { lineBytes, type LineData } from './lines.js';
import { coverSources, type CoverPatch } from './renderCover.js';
import { PATCH_RECTANGLE_BYTES, PatchGeometry } from './patchGeometry.js';
import { fillBytes, type FillData } from './fills.js';
import { createFillSurface } from './fillSurface.js';
import { buildingBytes, type BuildingData } from './buildings.js';
import { createBuildingSurface, createBuildingState, setBuildingClip } from './buildingSurface.js';
import { createLineState, updateLineState } from './lineStyle.js';
import { labelBytes, type LabelCandidate } from '../labels/candidates.js';

interface DrawInstance { mesh: Mesh<PatchGeometry, MeshBasicNodeMaterial>; lines: undefined | ReturnType<typeof createLineSurface>; fills: undefined | ReturnType<typeof createFillSurface>; buildings: undefined | ReturnType<typeof createBuildingSurface>; address: Address; cells: Address[]; resource: Surface; primary: boolean }
/** 一个来源对应区域、面、线批次；部分区域背景绘制同时写入内容使用的 stencil 归属。 */
export class TileSurfaces {
  readonly fogCenter = uniform(new Vector3()).setGroup(renderGroup);
  readonly fogStart = uniform(1).setGroup(renderGroup); readonly fogEnd = uniform(2).setGroup(renderGroup); readonly fogColor; readonly landColor;
  readonly palette = new MapPalette();
  readonly instances = new Map<string, DrawInstance>();
  private readonly ground: Mesh<PatchGeometry, MeshBasicNodeMaterial>;
  private disposed = false;
  private readonly resources = new Set<{ mesh: Mesh<PatchGeometry, MeshBasicNodeMaterial> }>();
  private originX = NaN; private originY = NaN;
  get geometryBytes(): number {
    let bytes = this.disposed ? 0 : this.ground.geometry.bytes;
    for (const r of this.resources) bytes += r.mesh.geometry.bytes;
    for (const i of this.instances.values()) if (!i.primary) bytes += i.mesh.geometry.bytes + i.resource.stateBytes;
    return bytes;
  }
  constructor(readonly scene: Scene, background: Color, readonly spherical = false) {
    scene.userData.mapPalette = this.palette;
    this.fogColor = uniform(background.clone()).setGroup(renderGroup); this.landColor = uniform(background.clone()).setGroup(renderGroup);
    scene.fogNode = fog(this.fogColor, max(smoothstep(this.fogStart, this.fogEnd, (this.spherical ? mapWorldPosition : positionWorld).sub(this.fogCenter).length()), this.spherical ? float(1).sub(smoothstep(0, .16, mapFacing)) : 0));
    const geometry = new PatchGeometry(); geometry.update({ z: 0, x: 0, y: 0 }, [{ z: 0, x: 0, y: 0 }]);
    // 每个绘制通道先绑定保留编号 0；后续部分区域使用 1～255，模板内容保持原值。
    // Three r185 的 WebGPU 动态编号缓存跨通道保留，显式起始编号使首个区域也完成绑定。
    const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, stencilWrite: true, stencilWriteMask: 0, stencilRef: 0 }); material.colorNode = this.landColor;
    material.vertexNode = mapVertex(positionLocal);
    this.ground = new Mesh(geometry, material); this.ground.frustumCulled = false; this.ground.renderOrder = -5;
    scene.add(this.ground);
  }
  patchBytes(address: Address): number { return PATCH_RECTANGLE_BYTES * (this.spherical ? 4 ** Math.max(0, 6 - address.z) : 1); }
  create(bitmap: ImageBitmap, address: Address, data?: LineData, fillData?: FillData, buildingData?: BuildingData, labels: LabelCandidate[] = []) {
    if (data) this.palette.encode(data.colors, data);
    if (fillData) this.palette.encode(fillData.colors, fillData);
    if (buildingData) this.palette.encode(buildingData.colors, buildingData);
    const map = new Texture(bitmap); map.colorSpace = SRGBColorSpace;
    map.flipY = false; map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true;
    const material = new MeshBasicNodeMaterial({ map, depthTest: false, depthWrite: false,
      stencilWrite: false, stencilWriteMask: 255, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp });
    material.colorNode = this.landColor;
    material.positionNode = positionLocal;
    if (this.spherical) {
      material.vertexNode = mapVertex(positionLocal);
      material.opacityNode = Fn(() => { mapFacing.lessThan(0).discard(); return float(1); })();
    }
    const geometry = new PatchGeometry(this.spherical); geometry.update(address, [address]);
    const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; mesh.visible = false; mesh.matrixAutoUpdate = false;
    const lines = data?.segments.length ? createLineSurface(data, this.spherical, true) : undefined;
    if (lines) { lines.mesh.renderOrder = 2; mesh.add(lines.mesh); }
    const fills = fillData?.indices.length ? createFillSurface(fillData, this.spherical, true) : undefined;
    if (fills) mesh.add(fills.mesh);
    const buildings = buildingData?.indices.length ? createBuildingSurface(buildingData, this.spherical, true) : undefined;
    if (buildings) mesh.add(buildings.mesh);
    const stateBytes = surfaceStateBytes(data, buildingData);
    const bindings = [data, fillData, buildingData].reduce((sum, item) => sum + (item ? bindingBytes(item) : 0), 0);
    const resource = { mesh, map, bitmap, lines, fills, buildings, labels, stateBytes, bytes: Math.ceil(bitmap.width * bitmap.height * 4 * 4 / 3) + lineBytes(data) + fillBytes(fillData) + buildingBytes(buildingData) + stateBytes, cpuBytes: bitmap.width * bitmap.height * 4 + lineBytes(data) + fillBytes(fillData) + buildingBytes(buildingData) + stateBytes + labelBytes(labels) + bindings };
    this.resources.add(resource); return resource;
  }
  commit(patches: readonly CoverPatch[], resources: ReadonlyMap<string, { surface?: Surface }>, origin: MapOrigin): void {
    const draws = coverSources(patches); const active = new Set(draws.map(d => keyOf(d.address)));
    for (const [id, i] of this.instances) if (!active.has(id)) {
      this.scene.remove(i.mesh); i.mesh.visible = false;
      if (!i.primary) { i.mesh.geometry.dispose(); i.mesh.material.dispose(); i.lines?.mesh.material.dispose(); i.fills?.mesh.material.dispose(); i.buildings?.mesh.material.dispose(); }
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
        const mesh = primary ? resource.mesh : new Mesh(new PatchGeometry(this.spherical), resource.mesh.material.clone());
        let lines = primary ? resource.lines : undefined;
        let fills = primary ? resource.fills : undefined;
        let buildings = primary ? resource.buildings : undefined;
        if (!primary && resource.buildings) {
          const buildingMesh = new Mesh(resource.buildings.mesh.geometry, resource.buildings.mesh.material.clone());
          buildingMesh.frustumCulled = false; buildingMesh.renderOrder = 3;
          const state = createBuildingState(); buildingMesh.userData.buildingState = state;
          mesh.add(buildingMesh); buildings = { ...resource.buildings, mesh: buildingMesh, ...state };
        }
        if (!primary && resource.fills) {
          const fillMesh = new Mesh(resource.fills.mesh.geometry, resource.fills.mesh.material.clone());
          fillMesh.frustumCulled = false; fillMesh.renderOrder = 1;
          const state = { viewZoom: { value: 15 } }; fillMesh.userData.fillState = state;
          mesh.add(fillMesh); fills = { ...resource.fills, mesh: fillMesh, ...state };
        }
        if (!primary && resource.lines) {
          const lineMesh = new Mesh(resource.lines.mesh.geometry, resource.lines.mesh.material.clone());
          lineMesh.frustumCulled = false; lineMesh.renderOrder = 2;
          const state = createLineState(resource.lines.data);
          lineMesh.userData.lineState = state; mesh.add(lineMesh); lines = { ...resource.lines, mesh: lineMesh, ...state };
        }
        instance = { mesh, lines, fills, buildings, address: draw.address, cells: draw.cells, resource, primary };
        mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; this.instances.set(id, instance); this.scene.add(mesh);
      }
      const stencilClip = clipped && (!!instance.lines || !!instance.fills);
      instance.cells = draw.cells;
      if (stencilClip && ++stencil > 255) throw new Error('部分区域来源超过 stencil 容量。');
      instance.mesh.geometry.update(draw.address, draw.cells);
      instance.mesh.visible = true; instance.mesh.material.stencilRef = stencil; instance.mesh.material.stencilWrite = stencilClip;
      // 平面底色由全局单批次提供；曲面底色与部分区域 stencil 采用来源网格。
      instance.mesh.material.visible = !!this.scene.userData.mapProjection?.center.w || stencilClip;
      if (instance.lines) { instance.lines.mesh.material.stencilRef = stencil; instance.lines.mesh.material.stencilWrite = stencilClip; }
      if (instance.fills) { instance.fills.mesh.material.stencilRef = stencil; instance.fills.mesh.material.stencilWrite = stencilClip; }
      if (instance.buildings) setBuildingClip(instance.buildings.mesh.userData.buildingState, draw.address, draw.cells);
      this.place(instance.mesh, draw.address, origin);
    }
    this.originX = origin.meters.x; this.originY = origin.meters.y;
  }
  update(origin: MapOrigin, viewZoom: number): void {
    const curved = !!this.scene.userData.mapProjection?.center.w;
    // 球面仍提交两三角形的状态基准；颜色写入由球面底面负责。
    this.ground.material.colorWrite = !curved;
    this.ground.position.set(this.fogCenter.value.x, 0, this.fogCenter.value.z);
    this.ground.scale.set(this.fogEnd.value * 2, 1, this.fogEnd.value * 2);
    const moved = origin.meters.x !== this.originX || origin.meters.y !== this.originY;
    for (const i of this.instances.values()) {
      i.mesh.material.visible = curved || i.mesh.material.stencilWrite;
      if (moved) this.place(i.mesh, i.address, origin);
      if (i.lines) updateLineState(i.lines, i.address, viewZoom);
      if (i.fills) i.fills.viewZoom.value = viewZoom;
      if (i.buildings) { i.buildings.viewZoom.value = viewZoom; i.buildings.mesh.visible = viewZoom >= i.buildings.minZoom; }
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
    surface.fills?.mesh.geometry.dispose(); surface.fills?.mesh.material.dispose();
    surface.buildings?.mesh.geometry.dispose(); surface.buildings?.mesh.material.dispose();
    this.scene.remove(surface.mesh); surface.mesh.material.dispose(); surface.map.dispose(); surface.bitmap.close();
  }
  dispose(): void {
    this.disposed = true; this.ground.geometry.dispose(); this.ground.material.dispose(); this.ground.removeFromParent();
    for (const i of this.instances.values()) {
      this.scene.remove(i.mesh);
      if (!i.primary) { i.mesh.geometry.dispose(); i.mesh.material.dispose(); i.lines?.mesh.material.dispose(); i.fills?.mesh.material.dispose(); i.buildings?.mesh.material.dispose(); }
    }
    this.instances.clear();
  }
}
export type Surface = ReturnType<TileSurfaces['create']>;

