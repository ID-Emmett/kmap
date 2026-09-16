import { mapVertex, mapFacing } from '../globe/projection.js';
import { BufferAttribute, BufferGeometry, DoubleSide, EqualStencilFunc, KeepStencilOp, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, attribute, max, positionLocal, uniform, varying, vec4 } from 'three/tsl';
import type { FillData } from './fills.js';

/** 原生矢量面在同一次绘制内完成三角形覆盖，样式可见范围按相机缩放求值。 */
export function createFillSurface(data: FillData, curved = false) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('fillColor', new BufferAttribute(data.colors, 3));
  geometry.setAttribute('fillStyle', new BufferAttribute(data.styles, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  const mesh = new Mesh(geometry, (curved ? curvedMaterial : material).clone()); mesh.frustumCulled = false; mesh.renderOrder = 1;
  const state = { viewZoom: { value: 15 } }; mesh.userData.fillState = state;
  return { mesh, data, ...state, vertices: data.positions.length / 3, indices: data.indices.length };
}

const viewZoom = uniform(15).onObjectUpdate(({ object }) => object!.userData.fillState.viewZoom.value);
const style = varying(attribute<'vec3'>('fillStyle', 'vec3')).setInterpolation('flat');
function createMaterial(curved: boolean) {
const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
  stencilWrite: true, stencilWriteMask: 0, stencilFunc: EqualStencilFunc, stencilZPass: KeepStencilOp });
if (curved) material.vertexNode = mapVertex(positionLocal);
material.forceSinglePass = true; material.positionNode = positionLocal;
material.colorNode = Fn(() => {
    if (curved) mapFacing.lessThan(0).discard();
  max(positionLocal.x.abs(), positionLocal.z.abs()).greaterThan(.500001).discard();
  viewZoom.lessThan(style.x).or(viewZoom.greaterThanEqual(style.y)).discard();
  return vec4(attribute<'vec3'>('fillColor', 'vec3'), style.z);
})();

return material;
}
const material = createMaterial(false), curvedMaterial = createMaterial(true);
