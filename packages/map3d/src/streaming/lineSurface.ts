import { mapVertex, mapFacing } from '../globe/projection.js';
import { Vector4, DoubleSide, EqualStencilFunc, InstancedBufferAttribute, InstancedBufferGeometry, KeepStencilOp, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { Fn, If, attribute, uniformArray, float, fwidth, max, min, mix, uint, positionLocal, smoothstep, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { LineData } from './lines.js';
import { createLineState, lineStyleCapacity } from './lineStyle.js';

/** 单次绘制批量合成所有线图层，胶囊距离场提供圆端点与抗锯齿。 */
export function createLineSurface(data: LineData, curved = false) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index; geometry.attributes = plane.attributes;
  geometry.instanceCount = data.segments.length / 4;
  geometry.setAttribute('lineSegment', new InstancedBufferAttribute(data.segments, 4));
  geometry.setAttribute('lineStyle', new InstancedBufferAttribute(data.styles, 4));
  geometry.setAttribute('lineColor', new InstancedBufferAttribute(data.colors, 3));
  const joins = data.joins ?? new Float32Array(geometry.instanceCount * 4);
  if (!data.joins) for (let i = 0; i < geometry.instanceCount; i++) {
    const dx = data.segments[i * 4 + 2]! - data.segments[i * 4]!, dy = data.segments[i * 4 + 3]! - data.segments[i * 4 + 1]!, length = Math.hypot(dx, dy) || 1;
    joins.set([-dy / length, dx / length, -dy / length, dx / length], i * 4);
  }
  geometry.setAttribute('lineJoin', new InstancedBufferAttribute(joins, 4));
  geometry.setAttribute('lineCaps', new InstancedBufferAttribute(data.caps ?? new Uint8Array(geometry.instanceCount * 2).fill(1), 2));
  geometry.setAttribute('lineDistance', new InstancedBufferAttribute(data.distances, 1));
  const count = lineStyleCapacity(data.paints.length);
  const key = `${count}:${curved}`;
  let template = lineMaterials.get(key);
  if (!template) { template = createLineMaterial(count, curved); lineMaterials.set(key, template); }
  const material = template.clone();
  const mesh = new Mesh(geometry, material); mesh.frustumCulled = false;
  const state = createLineState(data);
  mesh.userData.lineState = state;
  return { mesh, ...state, vertices: geometry.instanceCount * 4, indices: geometry.instanceCount * 6 };
}

/** 节点图由所有瓦片共享，对象组在绘制时读取各瓦片的宽度比例。 */
function createLineMaterial(count: number, curved: boolean) {
  const pixelScale = uniform(1 / 256).onObjectUpdate(({ object }) => object!.userData.lineState.pixelScale.value);
  const viewZoom = uniform(15).onObjectUpdate(({ object }) => object!.userData.lineState.viewZoom.value);
  const segment = attribute<'vec4'>('lineSegment', 'vec4');
  const style = varying(attribute<'vec4'>('lineStyle', 'vec4')).setInterpolation('flat');
  const widths = uniformArray(Array.from({ length: count }, () => new Vector4()), 'vec4' as const).onObjectUpdate(frame => frame?.object?.userData.lineState.widths);
  const dashes = uniformArray(Array.from({ length: count }, () => new Vector4()), 'vec4' as const).onObjectUpdate(frame => frame?.object?.userData.lineState.dashes);
  // 查表在顶点阶段求值，flat 保持每个实例的离散样式与宽度。
  const width = varying(max(widths.element(uint(style.x)).x, 1e-10)).setInterpolation('flat');
  const dash = varying(dashes.element(uint(style.x))).setInterpolation('flat');
  const delta = segment.zw.sub(segment.xy); const length = varying(delta.length()).setInterpolation('flat');
  const radius = width.mul(.5);
  const caps = varying(attribute<'vec2'>('lineCaps', 'vec2')).setInterpolation('flat');
  const extension = radius.add(pixelScale);
  const along = uv().x.mul(length.add(extension.mul(caps.x.add(caps.y)))).sub(extension.mul(caps.x));
  const across = uv().y.mul(2).sub(1).mul(radius.add(pixelScale));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
    stencilWrite: true, stencilWriteMask: 0, stencilFunc: EqualStencilFunc, stencilZPass: KeepStencilOp });
  if (curved) material.vertexNode = mapVertex(positionLocal);
  material.forceSinglePass = true;
  material.positionNode = Fn(() => {
    const direction = delta.normalize();
    const joins = attribute<'vec4'>('lineJoin', 'vec4');
    const offset = direction.mul(along).add(mix(joins.xy, joins.zw, uv().x).mul(across));
    const point = segment.xy.add(offset);
    return vec3(point.x, 0, point.y);
  })();
  material.colorNode = Fn(() => {
    const distance = vec2(max(max(along.negate(), along.sub(length)), 0), across).length().sub(radius);
    const aa = max(fwidth(distance), 1e-10).toVar();
    const period = dash.x.add(dash.y).add(dash.z).add(dash.w);
    const dashAA = max(fwidth(along).div(width), 1e-5).toVar();
    const dashAlpha = float(1).toVar();
    If(period.greaterThan(0), () => {
      const phase = along.add(varying(attribute<'float'>('lineDistance', 'float')).setInterpolation('flat')).div(width).mod(period);
      // 相邻周期的实段共同参与距离，周期接缝处保持连续覆盖。
      const first = min(max(phase.negate(), phase.sub(dash.x)), period.sub(phase));
      const secondStart = dash.x.add(dash.y);
      const second = max(secondStart.sub(phase), phase.sub(secondStart.add(dash.z)));
      const dashDistance = dash.z.greaterThan(0).select(min(first, second), first);
      const resolved = float(1).sub(smoothstep(dashAA.negate(), dashAA, dashDistance));
      const duty = dash.x.add(dash.z).div(period);
      dashAlpha.assign(mix(resolved, duty, smoothstep(.25, .75, dashAA.div(period))));
    });
    const alpha = float(1).sub(smoothstep(aa.negate(), aa, distance)).mul(style.y).mul(dashAlpha);
    // 导数在分支裁剪之前求值，保留片元四元组的完整采样。
    if (curved) mapFacing.lessThan(0).discard();
    max(positionLocal.x.abs(), positionLocal.z.abs()).greaterThan(.500001).discard();
    viewZoom.lessThan(style.z).or(viewZoom.greaterThanEqual(style.w.add(1))).discard();
    alpha.lessThanEqual(.001).discard();
    return vec4(attribute<'vec3'>('lineColor', 'vec3'), alpha);
  })();
  return material;
}

const lineMaterials = new Map<string, MeshBasicNodeMaterial>();
