import { Vector4, DoubleSide, EqualStencilFunc, InstancedBufferAttribute, InstancedBufferGeometry, KeepStencilOp, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { Fn, attribute, uniformArray, float, fwidth, max, min, uint, positionLocal, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { LineData } from './lines.js';
import { createLineState } from './lineStyle.js';

/** 单次绘制批量合成所有线图层，胶囊距离场提供圆端点与抗锯齿。 */
export function createLineSurface(data: LineData) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index; geometry.attributes = plane.attributes;
  geometry.instanceCount = data.segments.length / 4;
  geometry.setAttribute('lineSegment', new InstancedBufferAttribute(data.segments, 4));
  geometry.setAttribute('lineStyle', new InstancedBufferAttribute(data.styles, 4));
  geometry.setAttribute('lineColor', new InstancedBufferAttribute(data.colors, 3));
  geometry.setAttribute('lineDistance', new InstancedBufferAttribute(data.distances, 1));
  const material = lineMaterial.clone();
  const mesh = new Mesh(geometry, material); mesh.frustumCulled = false;
  const state = createLineState(data);
  mesh.userData.lineState = state;
  return { mesh, ...state, vertices: geometry.instanceCount * 4, indices: geometry.instanceCount * 6 };
}

/** 节点图由所有瓦片共享，对象组在绘制时读取各瓦片的宽度比例。 */
function createLineMaterial() {
  const pixelScale = uniform(1 / 256).onObjectUpdate(({ object }) => object!.userData.lineState.pixelScale.value);
  const viewZoom = uniform(15).onObjectUpdate(({ object }) => object!.userData.lineState.viewZoom.value);
  const segment = attribute<'vec4'>('lineSegment', 'vec4'); const style = attribute<'vec4'>('lineStyle', 'vec4');
  const widths = uniformArray(Array.from({ length: 128 }, () => new Vector4()), 'vec4' as const).onObjectUpdate(frame => frame?.object?.userData.lineState.widths);
  const dashes = uniformArray(Array.from({ length: 128 }, () => new Vector4()), 'vec4' as const).onObjectUpdate(frame => frame?.object?.userData.lineState.dashes);
  const width = max(widths.element(uint(style.x)).x, 1e-10);
  const dash = dashes.element(uint(style.x));
  const delta = segment.zw.sub(segment.xy); const length = delta.length();
  const radius = width.mul(.5);
  const along = uv().x.mul(length.add(radius.mul(2))).sub(radius);
  const across = uv().y.mul(2).sub(1).mul(radius.add(pixelScale));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
    stencilWrite: true, stencilWriteMask: 0, stencilFunc: EqualStencilFunc, stencilZPass: KeepStencilOp });
  material.forceSinglePass = true;
  material.positionNode = Fn(() => {
    const direction = delta.normalize();
    const offset = direction.mul(along).add(vec2(direction.y.negate(), direction.x).mul(across));
    const point = segment.xy.add(offset);
    return vec3(point.x, 0, point.y);
  })();
  material.colorNode = Fn(() => {
    max(positionLocal.x.abs(), positionLocal.z.abs()).greaterThan(.500001).discard();
    viewZoom.lessThan(style.z).or(viewZoom.greaterThanEqual(style.w.add(1))).discard();
    const distance = vec2(max(max(along.negate(), along.sub(length)), 0), across).length().sub(radius);
    const aa = max(fwidth(distance), 1e-10);
    const period = dash.x.add(dash.y).add(dash.z).add(dash.w);
    const phase = along.add(attribute('lineDistance', 'float')).div(width).mod(max(period, 1e-10));
    const first = max(phase.negate(), phase.sub(dash.x));
    const secondStart = dash.x.add(dash.y);
    const second = max(secondStart.sub(phase), phase.sub(secondStart.add(dash.z)));
    const dashDistance = dash.z.greaterThan(0).select(min(first, second), first);
    const dashAA = max(fwidth(along.div(width)), 1e-5);
    const dashAlpha = period.greaterThan(0).select(float(1).sub(smoothstep(dashAA.negate(), dashAA, dashDistance)), 1);
    const alpha = float(1).sub(smoothstep(aa.negate(), aa, distance)).mul(style.y).mul(dashAlpha);
    alpha.lessThanEqual(.001).discard();
    return vec4(attribute<'vec3'>('lineColor', 'vec3'), alpha);
  })();
  return material;
}

const lineMaterial = createLineMaterial();
