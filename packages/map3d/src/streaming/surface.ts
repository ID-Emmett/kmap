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
  private readonly resources = new Set<{ mesh: Mesh<PatchGeometry, MeshBasicNodeMaterial> }>();
  private originX = NaN; private originY = NaN;
  get geometryBytes(): number {
    let bytes = 0;
    for (const r of this.resources) bytes += r.mesh.geometry.bytes;
    for (const i of this.instances.values()) if (!i.primary) bytes += i.mesh.geometry.bytes + i.resource.stateBytes;
    return bytes;
  }
  constructor(readonly scene: Scene, background: Color, readonly spherical = false) {
    scene.userData.mapPalette = this.palette;
    this.fogColor = uniform(background.clone()).setGroup(renderGroup); this.landColor = uniform(background.clone()).setGroup(renderGroup);
    scene.fogNode = fog(this.fogColor, max(smoothstep(this.fogStart, this.fogEnd, (this.spherical ? mapWorldPosition : positionWorld).sub(this.fogCenter).length()), this.spherical ? float(1).sub(smoothstep(0, .16, mapFacing)) : 0));
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
      // 原生面使用全局背景；部分区域需要背景批次同步写入 stencil 归属。
      instance.mesh.material.visible = this.spherical && draw.address.z < 8 || !instance.fills || stencilClip;
      if (instance.lines) { instance.lines.mesh.material.stencilRef = stencil; instance.lines.mesh.material.stencilWrite = stencilClip; }
      if (instance.fills) { instance.fills.mesh.material.stencilRef = stencil; instance.fills.mesh.material.stencilWrite = stencilClip; }
      if (instance.buildings) setBuildingClip(instance.buildings.mesh.userData.buildingState, draw.address, draw.cells);
      this.place(instance.mesh, draw.address, origin);
    }
    this.originX = origin.meters.x; this.originY = origin.meters.y;
  }
  update(origin: MapOrigin, viewZoom: number): void {
    const moved = origin.meters.x !== this.originX || origin.meters.y !== this.originY;
    for (const i of this.instances.values()) {
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
    for (const i of this.instances.values()) {
      this.scene.remove(i.mesh);
      if (!i.primary) { i.mesh.geometry.dispose(); i.mesh.material.dispose(); i.lines?.mesh.material.dispose(); i.fills?.mesh.material.dispose(); i.buildings?.mesh.material.dispose(); }
    }
    this.instances.clear();
  }
}
export type Surface = ReturnType<TileSurfaces['create']>;

