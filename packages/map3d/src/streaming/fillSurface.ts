import { paletteColor, paletteOpacity } from '../style/palette.js';
import { mapVertex, mapFacing } from '../globe/projection.js';
import { BufferGeometry, DoubleSide, EqualStencilFunc, KeepStencilOp, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, attribute, positionLocal, renderGroup, uniform, varying, vec4 } from 'three/tsl';
import type { FillData } from './fills.js';
import { GeometryPool, capacityTier, registerGeometry, releaseGeometry, writeAttribute, writeIndex } from './geometryPool.js';
import { DrawSlotPool } from './drawSlots.js';

export const FILL_GEOMETRY_KEY = 'fill';
export type FillSurface = ReturnType<typeof createFillSurface>;
/** 固定绘制槽位：mesh 与材质一体复用，绑定组在交互期保持恒定。 */
export interface FillUnit { mesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>; material: MeshBasicNodeMaterial; key: string; spawn: () => FillUnit }

/** 原生矢量面在同一次绘制内完成三角形覆盖，样式可见范围按相机缩放求值。 */
export function createFillSurface(data: FillData, curved = false, themed = false, pool?: GeometryPool, slots?: DrawSlotPool<FillUnit>) {
  const vertices = data.positions.length / 3;
  const tier = capacityTier(Math.max(vertices, data.indices.length));
  let geometry = pool?.acquire(FILL_GEOMETRY_KEY, tier);
  if (geometry === undefined) { geometry = new BufferGeometry(); geometry.userData.poolTier = tier; registerGeometry(geometry); }
  writeAttribute(geometry, 'position', data.positions, 3, false, tier * 3);
  writeAttribute(geometry, 'fillColor', data.colors, 3, false, tier * 3);
  writeAttribute(geometry, 'fillStyle', data.styles, 3, false, tier * 3);
  writeIndex(geometry, data.indices, tier);
  const key = `${curved}:${themed}`;
  const unit = slots?.acquire(key, () => createFillUnit(curved, themed)) ?? createFillUnit(curved, themed);
  unit.mesh.geometry = geometry; unit.mesh.visible = true;
  return { mesh: unit.mesh, unit, data, vertices, indices: data.indices.length };
}

/** 释放面几何与槽位：几何按分档键回到池中，材质随槽位复用。 */
export function releaseFillSurface(surface: FillSurface, pool: GeometryPool, slots?: DrawSlotPool<FillUnit>): void {
  const geometry = surface.mesh.geometry;
  surface.mesh.removeFromParent();
  releaseGeometry(pool, FILL_GEOMETRY_KEY, geometry);
  if (slots) slots.release(surface.unit.key, surface.unit);
  else surface.mesh.material.dispose();
}

function createFillUnit(curved: boolean, themed: boolean): FillUnit {
  const key = `${curved}:${themed}`;
  const material = materials[Number(curved) + Number(themed) * 2]!.clone();
  const mesh = new Mesh(undefined, material); mesh.frustumCulled = false; mesh.renderOrder = 1;
  return { mesh, material, key, spawn: () => createFillUnit(curved, themed) };
}

/**
 * 渲染组共享的样式缩放：所有瓦片在同一帧看到相同的值。
 * 逐对象 uniform 会让每个绘制实例各自占用一个绑定槽并逐帧比较写入，
 * 共享后每帧只写一次，绘制成本与可见瓦片数解耦。
 */
const tileZoom = uniform(15).setGroup(renderGroup);
export function setFillTileZoom(value: number): void { tileZoom.value = value; }
const style = varying(attribute<'vec3'>('fillStyle', 'vec3')).setInterpolation('flat');
function createMaterial(curved: boolean, themed: boolean) {
const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
  stencilWrite: true, stencilWriteMask: 0, stencilFunc: EqualStencilFunc, stencilZPass: KeepStencilOp });
if (curved) material.vertexNode = mapVertex(positionLocal);
material.forceSinglePass = true; material.positionNode = positionLocal;
material.colorNode = Fn(() => {
    if (curved) mapFacing.lessThan(0).discard();
  tileZoom.lessThan(style.x).or(tileZoom.greaterThanEqual(style.y)).discard();
  const source = attribute<'vec3'>('fillColor', 'vec3'), alpha = style.z.mul(themed ? paletteOpacity(source) : 1);
  alpha.lessThan(.001).discard();
  return vec4(paletteColor(source, themed), alpha);
})();

return material;
}
const materials = [createMaterial(false, false), createMaterial(true, false), createMaterial(false, true), createMaterial(true, true)];
