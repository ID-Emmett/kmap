import { paletteColor, paletteOpacity, paletteStyle } from '../style/palette.js';
import { mapVertex } from '../globe/projection.js';
import { type ArrayNode, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { GeometryPool, registerGeometry, releaseGeometry, writeAttribute, writeIndex } from './geometryPool.js';
import { Fn, Loop, attribute, buffer, element, float, max, normalWorld, positionLocal, renderGroup, uniform, varying, vec3, vec4 } from 'three/tsl';
import type { BuildingData } from './buildings.js';
import type { Address } from './address.js';
import { capacityTier } from './geometryPool.js';
import { DrawSlotPool } from './drawSlots.js';

export function createBuildingState() { return { viewZoom: { value: 15 }, clipCount: 0, clips: new Float32Array(256 * 4) }; }

export function setBuildingClip(state: ReturnType<typeof createBuildingState>, source: Address, cells: readonly Address[]): void {
  if (cells.length > 256) throw new Error('建筑裁剪区域超出 256 个。');
  if (cells.length === 1 && cells[0]!.z === source.z && cells[0]!.x === source.x && cells[0]!.y === source.y) { state.clipCount = 0; return; }
  state.clipCount = cells.length;
  cells.forEach((cell, i) => {
    const scale = 2 ** (source.z - cell.z), x = cell.x * scale - source.x - .5, y = cell.y * scale - source.y - .5;
    state.clips.set([x, y, x + scale, y + scale], i * 4);
  });
}

export const BUILDING_GEOMETRY_KEY = 'building';
export type BuildingSurface = ReturnType<typeof createBuildingSurface>;
/** 固定绘制槽位：mesh、材质与裁剪缓冲一体复用，绑定组在交互期保持恒定。 */
export interface BuildingUnit { mesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>; material: MeshBasicNodeMaterial; state: ReturnType<typeof createBuildingState>; key: string; spawn: () => BuildingUnit }

/** 深度缓冲处理建筑互相遮挡；固定太阳方向与墙脚梯度在单次绘制中计算。 */
export function createBuildingSurface(data: BuildingData, curved = false, themed = false, pool?: GeometryPool, slots?: DrawSlotPool<BuildingUnit>) {
  const vertices = data.positions.length / 3;
  const tier = capacityTier(Math.max(vertices, data.indices.length));
  let geometry = pool?.acquire(BUILDING_GEOMETRY_KEY, tier);
  if (geometry === undefined) { geometry = new BufferGeometry(); geometry.userData.poolTier = tier; registerGeometry(geometry); }
  for (const [name, values] of Object.entries({ position: data.positions, normal: data.normals, buildingColor: data.colors, buildingStyle: data.styles }))
    writeAttribute(geometry, name, values, 3, false, tier * 3);
  writeIndex(geometry, data.indices, tier);
  const key = `${curved}:${themed}`;
  const unit = slots?.acquire(key, () => createBuildingUnit(curved, themed)) ?? createBuildingUnit(curved, themed);
  // 槽位复用：裁剪表就地清零，数组对象保持不变以复用已分配的 GPUBuffer。
  unit.state.clipCount = 0;
  const mesh = unit.mesh; mesh.geometry = geometry; mesh.visible = true;
  let minZoom = Infinity;
  for (let i = 0; i < data.styles.length; i += 3) minZoom = Math.min(minZoom, Math.round(data.styles[i]! * 10000) / 10000);
  return { mesh, unit, ...unit.state, minZoom, vertices, indices: data.indices.length, features: data.features };
}

/** 释放建筑几何与槽位：几何按分档键回到池中，材质随槽位复用。 */
export function releaseBuildingSurface(surface: BuildingSurface, pool: GeometryPool, slots?: DrawSlotPool<BuildingUnit>): void {
  const geometry = surface.mesh.geometry;
  surface.mesh.removeFromParent();
  releaseGeometry(pool, BUILDING_GEOMETRY_KEY, geometry);
  if (slots) slots.release(surface.unit.key, surface.unit);
  else surface.mesh.material.dispose();
}

function createBuildingUnit(curved: boolean, themed: boolean): BuildingUnit {
  const key = `${curved}:${themed}`;
  const material = materials[Number(curved) + Number(themed) * 2]!.clone();
  const mesh = new Mesh(undefined, material); mesh.frustumCulled = false; mesh.renderOrder = 3;
  const state = createBuildingState(); mesh.userData.buildingState = state;
  return { mesh, material, state, key, spawn: () => createBuildingUnit(curved, themed) };
}

/** 渲染组共享的视图缩放：所有瓦片同帧同值，每帧只写一次。 */
const viewZoom = uniform(15).setGroup(renderGroup);
export function setBuildingViewZoom(value: number): void { viewZoom.value = value; }
/** 当前共享的视图缩放；用于确认渲染组 uniform 每帧同步一次。 */
export function buildingViewZoom(): number { return viewZoom.value; }
const style = attribute<'vec3'>('buildingStyle', 'vec3');
const zoomRange = varying(style.xy).setInterpolation('flat');
const clips = buffer(new Float32Array(256 * 4), 'vec4', 256).onObjectUpdate(frame => frame.object!.userData.buildingState.clips) as unknown as ArrayNode<'vec4'>;
const clipCount = uniform(0, 'int').onObjectUpdate(({ object }) => object!.userData.buildingState.clipCount);
// 底图透明队列先绘制；建筑在同一队列末尾以不透明 alpha 和深度写入合成。
function createMaterial(curved: boolean, themed: boolean) {
const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: true, side: DoubleSide });
material.forceSinglePass = true;
const sourceColor = attribute<'vec3'>('buildingColor', 'vec3');
const position = vec3(positionLocal.x, positionLocal.y.mul(themed ? paletteStyle(sourceColor).y : 1), positionLocal.z);
material.positionNode = position;
if (curved) material.vertexNode = mapVertex(position);
material.colorNode = Fn(() => {
  max(positionLocal.x.abs(), positionLocal.z.abs()).greaterThan(.500001).discard();
  viewZoom.lessThan(zoomRange.x).or(viewZoom.greaterThanEqual(zoomRange.y)).discard();
  const inside = float(0).toVar();
  Loop({ start: 0, end: clipCount, type: 'int' }, ({ i }) => {
    const rect = element(clips, i);
    inside.addAssign(positionLocal.x.greaterThanEqual(rect.x).and(positionLocal.x.lessThanEqual(rect.z))
      .and(positionLocal.z.greaterThanEqual(rect.y)).and(positionLocal.z.lessThanEqual(rect.w)).select(1, 0));
  });
  inside.equal(0).and(clipCount.greaterThan(0)).discard();
  const alpha = themed ? paletteOpacity(sourceColor) : float(1); alpha.lessThan(.001).discard();
  const sunlight = max(normalWorld.dot(vec3(-.45, .8, .4).normalize()), 0).mul(.3).add(.7);
  return vec4(paletteColor(attribute<'vec3'>('buildingColor', 'vec3'), themed).mul(sunlight).mul(style.z), alpha);
})();

return material;
}
const materials = [createMaterial(false, false), createMaterial(true, false), createMaterial(false, true), createMaterial(true, true)];
