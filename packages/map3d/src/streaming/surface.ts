import { bindingBytes, MapPalette } from '../style/palette.js';
import { mapVertex, mapFacing, mapWorldPosition } from '../globe/projection.js';
import { maskVertex } from './maskVertex.js';
import { surfaceStateBytes } from './surfaceBytes.js';
import { AlwaysStencilFunc, Color, DoubleSide, Mesh, MeshBasicNodeMaterial, ReplaceStencilOp, Vector3, type Scene } from 'three/webgpu';
import { Fn, float, fog, max, positionLocal, positionWorld, renderGroup, smoothstep, uniform } from 'three/tsl';
import type { MapOrigin } from '../spatial/types.js';
import { keyOf, tileBounds, type Address } from './address.js';
import { createLineSurface, LINE_GEOMETRY_KEY, releaseLineSurface, type LineUnit } from './lineSurface.js';
import { lineBytes, type LineData } from './lines.js';
import { coverSources, type CoverPatch } from './renderCover.js';
import { PATCH_RECTANGLE_BYTES, PatchGeometry } from './patchGeometry.js';
import { fillBytes, type FillData } from './fills.js';
import { createFillSurface, FILL_GEOMETRY_KEY, releaseFillSurface, setFillTileZoom, type FillUnit } from './fillSurface.js';
import { buildingBytes, type BuildingData } from './buildings.js';
import { BUILDING_GEOMETRY_KEY, createBuildingSurface, releaseBuildingSurface, setBuildingClip, setBuildingViewZoom, type BuildingUnit } from './buildingSurface.js';
import { GeometryPool, capacityTier, registerGeometry, releaseGeometry, retainGeometry } from './geometryPool.js';
import { DrawSlotPool } from './drawSlots.js';
import { fillLineState, updateLineState } from './lineStyle.js';
import { setLineTileZoom } from './lineSurface.js';
import { labelBytes, type LabelCandidate } from '../labels/candidates.js';

/** 模板矩形的固定绘制槽位：mesh 与材质一体复用。 */
const MASK_SLOT_KEY = 'mask';
export interface MaskUnit { mesh: Mesh<PatchGeometry, MeshBasicNodeMaterial>; material: MeshBasicNodeMaterial; key: string; spawn: () => MaskUnit }
interface DrawInstance { mesh: Mesh<PatchGeometry, MeshBasicNodeMaterial>; unit: MaskUnit; lines: undefined | ReturnType<typeof createLineSurface>; fills: undefined | ReturnType<typeof createFillSurface>; buildings: undefined | ReturnType<typeof createBuildingSurface>; address: Address; cells: Address[]; resource: Surface; primary: boolean }
/** 全部可绘制瓦片先写模板覆盖；内容按同一份模板逐采样点裁剪。 */
export class TileSurfaces {
  readonly fogCenter = uniform(new Vector3()).setGroup(renderGroup);
  readonly fogStart = uniform(1).setGroup(renderGroup); readonly fogEnd = uniform(2).setGroup(renderGroup); readonly fogColor; readonly landColor;
  readonly palette = new MapPalette();
  readonly instances = new Map<string, DrawInstance>();
  private readonly ground: Mesh<PatchGeometry, MeshBasicNodeMaterial>;
  private readonly maskMaterial: MeshBasicNodeMaterial;
  private disposed = false;
  private readonly resources = new Set<{ mesh: Mesh<PatchGeometry, MeshBasicNodeMaterial> }>();
  private originX = NaN; private originY = NaN;
  /** 几何字节增量维护，预算查询不再遍历全部资源与实例。 */
  #geometryBytes = 0;
  /** 池化的 GPU 几何：新瓦片复用已有缓冲，只写入实际使用范围。 */
  readonly pool = new GeometryPool();
  /** 固定绘制槽位：模板、线、面与建筑各自的 mesh 与材质按布局键复用。 */
  readonly maskSlots = new DrawSlotPool<MaskUnit>(320, unit => unit.material.dispose());
  readonly lineSlots = new DrawSlotPool<LineUnit>(320, unit => unit.material.dispose());
  readonly fillSlots = new DrawSlotPool<FillUnit>(320, unit => unit.material.dispose());
  readonly buildingSlots = new DrawSlotPool<BuildingUnit>(320, unit => unit.material.dispose());
  get geometryBytes(): number { return this.disposed ? 0 : this.#geometryBytes; }
  get poolSize(): number { return this.pool.size; }
  get poolBytes(): number { return this.pool.bytes; }
  /** 槽位复用统计：稳态下复用次数应持续增长而新建次数收敛。 */
  get slotStats(): { mask: number[]; line: number[]; fill: number[]; building: number[] } {
    return { mask: [this.maskSlots.reuses, this.maskSlots.creates], line: [this.lineSlots.reuses, this.lineSlots.creates],
      fill: [this.fillSlots.reuses, this.fillSlots.creates], building: [this.buildingSlots.reuses, this.buildingSlots.creates] };
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
    this.#geometryBytes = geometry.bytes;
    this.maskMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, side: DoubleSide,
      stencilWrite: true, stencilWriteMask: 255, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp });
    this.maskMaterial.colorNode = this.landColor;
    this.maskMaterial.positionNode = positionLocal; this.maskMaterial.vertexNode = maskVertex();
    if (this.spherical) this.maskMaterial.opacityNode = Fn(() => { mapFacing.lessThan(0).discard(); return float(1); })();
  }
  patchBytes(address: Address): number { return PATCH_RECTANGLE_BYTES * (this.spherical ? 4 ** Math.max(0, 6 - address.z) : 1); }
  create(bitmap: ImageBitmap, address: Address, data?: LineData, fillData?: FillData, buildingData?: BuildingData, labels: LabelCandidate[] = []) {
    if (data) this.palette.encode(data.colors, data);
    if (fillData) this.palette.encode(fillData.colors, fillData);
    if (buildingData) this.palette.encode(buildingData.colors, buildingData);
    // 位图只服务像素审计与资源生命周期；模板绘制不采样纹理，因此不创建、也不上传 GPU 纹理。
    const unit = this.maskSlots.acquire(MASK_SLOT_KEY, this.spawnMask);
    const geometry = this.acquirePatch(address); geometry.update(address, [address]);
    const mesh = unit.mesh; mesh.geometry = geometry;
    mesh.userData.maskSpan = tileBounds({ ...address, z: this.spherical ? Math.max(6, address.z) : address.z }).span;
    mesh.frustumCulled = false; mesh.visible = false; mesh.matrixAutoUpdate = false;
    const lines = data?.segments.length ? createLineSurface(data, this.spherical, true, this.pool, this.lineSlots) : undefined;
    if (lines) { lines.mesh.renderOrder = 2; mesh.add(lines.mesh); }
    const fills = fillData?.indices.length ? createFillSurface(fillData, this.spherical, true, this.pool, this.fillSlots) : undefined;
    if (fills) mesh.add(fills.mesh);
    const buildings = buildingData?.indices.length ? createBuildingSurface(buildingData, this.spherical, true, this.pool, this.buildingSlots) : undefined;
    if (buildings) mesh.add(buildings.mesh);
    const stateBytes = surfaceStateBytes(data, buildingData);
    const bindings = [data, fillData, buildingData].reduce((sum, item) => sum + (item ? bindingBytes(item) : 0), 0);
    const resource = { mesh, unit, bitmap, lines, fills, buildings, labels, stateBytes, bytes: lineBytes(data) + fillBytes(fillData) + buildingBytes(buildingData) + stateBytes, cpuBytes: bitmap.width * bitmap.height * 4 + lineBytes(data) + fillBytes(fillData) + buildingBytes(buildingData) + stateBytes + labelBytes(labels) + bindings };
    this.resources.add(resource); this.#geometryBytes += geometry.bytes; return resource;
  }
  commit(patches: readonly CoverPatch[], resources: ReadonlyMap<string, { surface?: Surface }>, origin: MapOrigin): void {
    // 完整来源矩形按父到子写入模板；子级覆盖父级编号，形成逐采样点唯一所有权。
    const draws = coverSources(patches).sort((a, b) => a.address.z - b.address.z); const active = new Set(draws.map(d => keyOf(d.address)));
    for (const [id, i] of this.instances) if (!active.has(id)) {
      this.scene.remove(i.mesh); i.mesh.visible = false;
      if (!i.primary) {
        this.#geometryBytes -= i.mesh.geometry.bytes + i.resource.stateBytes;
        // 共享几何按引用计数归还，独占的模板矩形直接回池。
        releaseGeometry(this.pool, this.patchKey, i.mesh.geometry);
        if (i.lines) releaseLineSurface(i.lines, this.pool, this.lineSlots);
        if (i.fills) releaseFillSurface(i.fills, this.pool, this.fillSlots);
        if (i.buildings) releaseBuildingSurface(i.buildings, this.pool, this.buildingSlots);
        this.maskSlots.release(i.unit.key, i.unit);
      } else {
        // 主实例只归还自己持有的几何引用；槽位与资源释放由 surface 回收时负责。
        releaseGeometry(this.pool, this.patchKey, i.mesh.geometry);
        if (i.lines) releaseGeometry(this.pool, LINE_GEOMETRY_KEY, i.lines.mesh.geometry);
        if (i.fills) releaseGeometry(this.pool, FILL_GEOMETRY_KEY, i.fills.mesh.geometry);
        if (i.buildings) releaseGeometry(this.pool, BUILDING_GEOMETRY_KEY, i.buildings.mesh.geometry);
      }
      this.instances.delete(id);
    }
    let stencil = 0;
    for (const draw of draws) {
      const resource = resources.get(draw.key)?.surface; if (!resource) continue;
      const id = keyOf(draw.address);
      let instance = this.instances.get(id);
      if (!instance) {
        const primary = ![...this.instances.values()].some(i => i.resource === resource && i.primary);
        // 非主实例也取固定槽位：每个槽位有自己的材质以承载独立的模板编号。
        const unit = primary ? resource.unit : this.maskSlots.acquire(MASK_SLOT_KEY, this.spawnMask);
        const mesh = unit.mesh;
        if (!primary) mesh.geometry = this.acquirePatch(draw.address);
        let lines = primary ? resource.lines : undefined;
        let fills = primary ? resource.fills : undefined;
        let buildings = primary ? resource.buildings : undefined;
        if (!primary && resource.buildings) {
          const unit = this.buildingSlots.acquire(resource.buildings.unit.key, resource.buildings.unit.spawn);
          unit.state.clipCount = 0; unit.mesh.geometry = resource.buildings.mesh.geometry; unit.mesh.visible = true;
          retainGeometry(resource.buildings.mesh.geometry);
          mesh.add(unit.mesh); buildings = { ...resource.buildings, mesh: unit.mesh, unit };
        }
        if (!primary && resource.fills) {
          const unit = this.fillSlots.acquire(resource.fills.unit.key, resource.fills.unit.spawn);
          unit.mesh.geometry = resource.fills.mesh.geometry; unit.mesh.visible = true;
          retainGeometry(resource.fills.mesh.geometry);
          mesh.add(unit.mesh); fills = { ...resource.fills, mesh: unit.mesh, unit };
        }
        if (!primary && resource.lines?.data) {
          const unit = this.lineSlots.acquire(resource.lines.unit.key, resource.lines.unit.spawn);
          fillLineState(unit.state, resource.lines.data);
          unit.mesh.geometry = resource.lines.mesh.geometry; unit.mesh.visible = true;
          retainGeometry(resource.lines.mesh.geometry);
          mesh.add(unit.mesh); lines = { ...resource.lines, mesh: unit.mesh, unit, ...unit.state };
        }
        if (!primary) this.#geometryBytes += mesh.geometry.bytes + resource.stateBytes;
        instance = { mesh, unit, lines, fills, buildings, address: draw.address, cells: draw.cells, resource, primary };
        // 主实例同样持有几何引用：瓦片被回收后实例可能仍在场景中（等下一次提交才移除），
        // 几何若提前回池会被其他瓦片写入新数据，正在显示的内容会被整块替换成别的瓦片。
        if (primary) {
          retainGeometry(mesh.geometry);
          if (lines) retainGeometry(lines.mesh.geometry);
          if (fills) retainGeometry(fills.mesh.geometry);
          if (buildings) retainGeometry(buildings.mesh.geometry);
        }
        mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; this.instances.set(id, instance); this.scene.add(mesh);
      }
      instance.cells = draw.cells;
      if (++stencil > 255) throw new Error('可绘制来源超过 stencil 容量。');
      instance.mesh.geometry.update(draw.address, [draw.address]);
      instance.mesh.renderOrder = -2 + stencil / 256;
      instance.mesh.visible = true; instance.mesh.material.stencilRef = stencil;
      if (instance.lines) instance.lines.mesh.material.stencilRef = stencil;
      if (instance.fills) instance.fills.mesh.material.stencilRef = stencil;
      if (instance.buildings) setBuildingClip(instance.buildings.mesh.userData.buildingState, draw.address, draw.cells);
      this.place(instance.mesh, draw.address, origin);
    }
    this.originX = origin.meters.x; this.originY = origin.meters.y;
  }
  update(origin: MapOrigin, viewZoom: number, tileZoom: number): void {
    const curved = !!this.scene.userData.mapProjection?.center.w;
    // 球面仍提交两三角形的状态基准；颜色写入由球面底面负责。
    this.ground.material.colorWrite = !curved;
    this.ground.position.set(this.fogCenter.value.x, 0, this.fogCenter.value.z);
    this.ground.scale.set(this.fogEnd.value * 2, 1, this.fogEnd.value * 2);
    const moved = origin.meters.x !== this.originX || origin.meters.y !== this.originY;
    // 样式缩放对所有瓦片同值：渲染组共享 uniform 每帧只写一次，逐对象写入不再随可见瓦片数增长。
    setLineTileZoom(tileZoom); setFillTileZoom(tileZoom); setBuildingViewZoom(viewZoom);
    for (const i of this.instances.values()) {
      if (moved) this.place(i.mesh, i.address, origin);
      if (i.lines) updateLineState(i.lines, i.address, viewZoom, tileZoom);
      if (i.buildings) i.buildings.mesh.visible = viewZoom >= i.buildings.minZoom;
    }
    this.originX = origin.meters.x; this.originY = origin.meters.y;
  }
  place(mesh: Mesh, address: Address, origin: MapOrigin): void {
    (mesh.geometry as PatchGeometry).updateWorld(origin);
    mesh.userData.maskSpan = tileBounds({ ...address, z: this.spherical ? Math.max(6, address.z) : address.z }).span;
    const b = tileBounds(address); mesh.position.set(b.west + b.span / 2 - origin.meters.x, 0, origin.meters.y - b.north + b.span / 2);
    mesh.scale.set(b.span, 1, b.span); mesh.updateMatrix();
  }
  release(surface: Surface): void {
    this.resources.delete(surface); this.#geometryBytes -= surface.mesh.geometry.bytes;
    releaseGeometry(this.pool, this.patchKey, surface.mesh.geometry);
    if (surface.lines) releaseLineSurface(surface.lines, this.pool, this.lineSlots);
    if (surface.fills) releaseFillSurface(surface.fills, this.pool, this.fillSlots);
    if (surface.buildings) releaseBuildingSurface(surface.buildings, this.pool, this.buildingSlots);
    this.scene.remove(surface.mesh);
    this.maskSlots.release(surface.unit.key, surface.unit); surface.bitmap.close();
  }
  dispose(): void {
    this.maskMaterial.dispose();
    this.disposed = true; this.#geometryBytes = 0; this.ground.geometry.dispose(); this.ground.material.dispose(); this.ground.removeFromParent();
    for (const i of this.instances.values()) {
      this.scene.remove(i.mesh);
      if (!i.primary) {
        releaseGeometry(this.pool, this.patchKey, i.mesh.geometry);
        if (i.lines) releaseLineSurface(i.lines, this.pool, this.lineSlots);
        if (i.fills) releaseFillSurface(i.fills, this.pool, this.fillSlots);
        if (i.buildings) releaseBuildingSurface(i.buildings, this.pool, this.buildingSlots);
        this.maskSlots.release(i.unit.key, i.unit);
      } else {
        // 主实例只归还自己持有的几何引用；材质与槽位由资源释放路径处理。
        releaseGeometry(this.pool, this.patchKey, i.mesh.geometry);
        if (i.lines) releaseGeometry(this.pool, LINE_GEOMETRY_KEY, i.lines.mesh.geometry);
        if (i.fills) releaseGeometry(this.pool, FILL_GEOMETRY_KEY, i.fills.mesh.geometry);
        if (i.buildings) releaseGeometry(this.pool, BUILDING_GEOMETRY_KEY, i.buildings.mesh.geometry);
      }
    }
    this.instances.clear();
    this.pool.dispose();
    this.maskSlots.dispose(); this.lineSlots.dispose(); this.fillSlots.dispose(); this.buildingSlots.dispose();
  }
  /** 模板矩形几何按投影模式与容量档位分池，重新获取后只重写实际区域。 */
  private get patchKey(): string { return this.spherical ? 'patch:curved' : 'patch'; }
  private acquirePatch(address: Address): PatchGeometry {
    const cells = this.spherical ? 4 ** Math.max(0, 6 - address.z) : 1;
    const tier = capacityTier(cells);
    const pooled = this.pool.acquire(this.patchKey, tier) as PatchGeometry | undefined;
    if (pooled !== undefined) return pooled;
    const geometry = new PatchGeometry(this.spherical); geometry.userData.poolTier = tier; registerGeometry(geometry); return geometry;
  }
  /** 新建模板槽位：材质从模板材质克隆，节点图在所有槽位间共享。 */
  private readonly spawnMask = (): MaskUnit => {
    const material = this.maskMaterial.clone();
    const mesh = new Mesh<PatchGeometry, MeshBasicNodeMaterial>(undefined, material);
    return { mesh, material, key: MASK_SLOT_KEY, spawn: this.spawnMask };
  };
}
export type Surface = ReturnType<TileSurfaces['create']>;

