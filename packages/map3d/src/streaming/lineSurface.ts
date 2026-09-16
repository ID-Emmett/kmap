import { DoubleSide, EqualStencilFunc, InstancedBufferAttribute, InstancedBufferGeometry, KeepStencilOp, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { Fn, attribute, float, fwidth, max, positionLocal, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { LineData } from './lines.js';

/** 单次绘制批量合成所有线图层，胶囊距离场提供圆端点与抗锯齿。 */
export function createLineSurface(data: LineData) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index; geometry.attributes = plane.attributes;
  geometry.instanceCount = data.segments.length / 4;
  geometry.setAttribute('lineSegment', new InstancedBufferAttribute(data.segments, 4));
  geometry.setAttribute('lineStyle', new InstancedBufferAttribute(data.styles, 4));
  geometry.setAttribute('lineColor', new InstancedBufferAttribute(data.colors, 3));
  const material = lineMaterial.clone();
  const mesh = new Mesh(geometry, material); mesh.frustumCulled = false;
  const state = { pixelScale: { value: 1 / 256 }, viewZoom: { value: 15 } };
  mesh.userData.lineState = state;
  return { mesh, ...state, vertices: geometry.instanceCount * 4, indices: geometry.instanceCount * 6 };
}

/** 节点图由所有瓦片共享，对象组在绘制时读取各瓦片的宽度比例。 */
function createLineMaterial() {
  const pixelScale = uniform(1 / 256).onObjectUpdate(({ object }) => object!.userData.lineState.pixelScale.value);
  const viewZoom = uniform(15).onObjectUpdate(({ object }) => object!.userData.lineState.viewZoom.value);
  const segment = attribute<'vec4'>('lineSegment', 'vec4'); const style = attribute<'vec4'>('lineStyle', 'vec4');
  const delta = segment.zw.sub(segment.xy); const length = delta.length().div(pixelScale);
  const radius = style.x.mul(.5);
  const along = uv().x.mul(length.add(radius.mul(2))).sub(radius);
  const across = uv().y.mul(2).sub(1).mul(radius.add(1));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
    stencilWrite: true, stencilWriteMask: 0, stencilFunc: EqualStencilFunc, stencilZPass: KeepStencilOp });
  material.forceSinglePass = true;
  material.positionNode = Fn(() => {
    const direction = delta.normalize();
    const offset = direction.mul(along).add(vec2(direction.y.negate(), direction.x).mul(across)).mul(pixelScale);
    const point = segment.xy.add(offset);
    return vec3(point.x, 0, point.y);
  })();
  material.colorNode = Fn(() => {
    max(positionLocal.x.abs(), positionLocal.z.abs()).greaterThan(.500001).discard();
    viewZoom.lessThan(style.z).or(viewZoom.greaterThanEqual(style.w.add(1))).discard();
    const distance = vec2(max(max(along.negate(), along.sub(length)), 0), across).length().sub(radius);
    const aa = max(fwidth(distance), .5);
    const alpha = float(1).sub(smoothstep(aa.negate(), aa, distance)).mul(style.y);
    alpha.lessThanEqual(.001).discard();
    return vec4(attribute<'vec3'>('lineColor', 'vec3'), alpha);
  })();
  return material;
}

const lineMaterial = createLineMaterial();
