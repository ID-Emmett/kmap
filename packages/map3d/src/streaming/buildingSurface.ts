import { Vector4, BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, Loop, attribute, uniformArray, float, max, normalWorld, positionLocal, uniform, vec3, vec4 } from 'three/tsl';
import type { BuildingData } from './buildings.js';
import type { Address } from './address.js';

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

/** 深度缓冲处理建筑互相遮挡；固定太阳方向与墙脚梯度在单次绘制中计算。 */
export function createBuildingSurface(data: BuildingData) {
  const geometry = new BufferGeometry();
  for (const [name, values] of Object.entries({ position: data.positions, normal: data.normals, buildingColor: data.colors, buildingStyle: data.styles }))
    geometry.setAttribute(name, new BufferAttribute(values, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  const mesh = new Mesh(geometry, material.clone()); mesh.frustumCulled = false; mesh.renderOrder = 3;
  const state = createBuildingState(); mesh.userData.buildingState = state;
  let minZoom = Infinity;
  for (let i = 0; i < data.styles.length; i += 3) minZoom = Math.min(minZoom, Math.round(data.styles[i]! * 10000) / 10000);
  return { mesh, ...state, minZoom, vertices: data.positions.length / 3, indices: data.indices.length, features: data.features };
}

const viewZoom = uniform(15).onObjectUpdate(({ object }) => object!.userData.buildingState.viewZoom.value);
const style = attribute<'vec3'>('buildingStyle', 'vec3');
const clips = uniformArray(Array.from({ length: 256 }, () => new Vector4()), 'vec4' as const).onObjectUpdate(frame => frame?.object?.userData.buildingState.clips);
const clipCount = uniform(0, 'int').onObjectUpdate(({ object }) => object!.userData.buildingState.clipCount);
// 底图透明队列先绘制；建筑在同一队列末尾以不透明 alpha 和深度写入合成。
const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: true, side: DoubleSide });
material.forceSinglePass = true;
material.positionNode = positionLocal;
material.colorNode = Fn(() => {
  max(positionLocal.x.abs(), positionLocal.z.abs()).greaterThan(.500001).discard();
  viewZoom.lessThan(style.x).or(viewZoom.greaterThanEqual(style.y)).discard();
  const inside = float(0).toVar();
  Loop({ start: 0, end: clipCount, type: 'int' }, ({ i }) => {
    const rect = clips.element(i);
    inside.addAssign(positionLocal.x.greaterThanEqual(rect.x).and(positionLocal.x.lessThanEqual(rect.z))
      .and(positionLocal.z.greaterThanEqual(rect.y)).and(positionLocal.z.lessThanEqual(rect.w)).select(1, 0));
  });
  inside.equal(0).and(clipCount.greaterThan(0)).discard();
  const sunlight = max(normalWorld.dot(vec3(-.45, .8, .4).normalize()), 0).mul(.3).add(.7);
  return vec4(attribute<'vec3'>('buildingColor', 'vec3').mul(sunlight).mul(style.z), 1);
})();
