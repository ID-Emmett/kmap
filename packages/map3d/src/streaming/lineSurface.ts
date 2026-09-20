import { paletteColor, paletteOpacity, paletteStyle } from '../style/palette.js';
import { mapVertex, mapFacing } from '../globe/projection.js';
import { type ArrayNode, DoubleSide, EqualStencilFunc, InstancedBufferAttribute, InstancedBufferGeometry, KeepStencilOp, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { Fn, If, attribute, buffer, element, float, fwidth, max, min, mix, uint, smoothstep, uniform, uv, varying, vec3, vec4 } from 'three/tsl';
import type { LineData } from './lines.js';
import { createLineState, lineStyleCapacity } from './lineStyle.js';

/** 连续中心线带采用共享折点挤出，端点为 butt，横向距离提供解析抗锯齿。 */
export function createLineSurface(data: LineData, curved = false, themed = false) {
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
  const key = `${count}:${curved}:${themed}`;
  let template = lineMaterials.get(key);
  if (!template) { template = createLineMaterial(count, curved, themed); lineMaterials.set(key, template); }
  const material = template.clone();
  const mesh = new Mesh(geometry, material); mesh.frustumCulled = false;
  const state = createLineState(data);
  mesh.userData.lineState = state;
  return { mesh, ...state, vertices: geometry.instanceCount * 4, indices: geometry.instanceCount * 6 };
}

/** 节点图由所有瓦片共享，对象组在绘制时读取各瓦片的宽度比例。 */
function createLineMaterial(count: number, curved: boolean, themed: boolean) {
  const pixelScale = uniform(1 / 256).onObjectUpdate(({ object }) => object!.userData.lineState.pixelScale.value);
  const tileZoom = uniform(15).onObjectUpdate(({ object }) => object!.userData.lineState.tileZoom.value);
  const segment = attribute<'vec4'>('lineSegment', 'vec4');
  const style = varying(attribute<'vec4'>('lineStyle', 'vec4')).setInterpolation('flat');
  // 固定 BufferNode 在新瓦片编译期间保持缓冲引用；绘制时绑定当前对象的数据。
  const widths = buffer(new Float32Array(count * 4), 'vec4', count).onObjectUpdate(frame => frame.object!.userData.lineState.widths) as unknown as ArrayNode<'vec4'>;
  const dashes = buffer(new Float32Array(count * 4), 'vec4', count).onObjectUpdate(frame => frame.object!.userData.lineState.dashes) as unknown as ArrayNode<'vec4'>;
  // 查表在顶点阶段求值，flat 保持每个实例的离散样式与宽度。
  const sourceColor = attribute<'vec3'>('lineColor', 'vec3');
  const width = varying(max(element(widths, uint(style.x)).x.mul(themed ? paletteStyle(sourceColor).x : 1), 1e-10)).setInterpolation('flat');
  const dash = varying(element(dashes, uint(style.x))).setInterpolation('flat');
  const delta = segment.zw.sub(segment.xy); const length = varying(delta.length()).setInterpolation('flat');
  const radius = width.mul(.5);
  const along = uv().x.mul(length);
  const across = uv().y.mul(2).sub(1).mul(radius.add(pixelScale));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
    stencilWrite: true, stencilWriteMask: 0, stencilFunc: EqualStencilFunc, stencilZPass: KeepStencilOp });
  material.forceSinglePass = true;
  const linePosition = Fn(() => {
    const direction = delta.normalize();
    const joins = attribute<'vec4'>('lineJoin', 'vec4');
    const offset = direction.mul(along).add(mix(joins.xy, joins.zw, uv().x).mul(across));
    const point = segment.xy.add(offset);
    return vec3(point.x, 0, point.y);
  })();
  material.positionNode = linePosition;
  if (curved) material.vertexNode = mapVertex(linePosition);
  material.colorNode = Fn(() => {
    const distance = across.abs().sub(radius);
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
    const alpha = float(1).sub(smoothstep(aa.negate(), aa, distance)).mul(style.y).mul(dashAlpha).mul(themed ? paletteOpacity(sourceColor) : 1);
    // 导数在分支裁剪之前求值，保留片元四元组的完整采样。
    if (curved) mapFacing.lessThan(0).discard();
    tileZoom.lessThan(style.z).or(tileZoom.greaterThanEqual(style.w)).discard();
    alpha.lessThanEqual(.001).discard();
    return vec4(paletteColor(attribute<'vec3'>('lineColor', 'vec3'), themed), alpha);
  })();
  return material;
}

const lineMaterials = new Map<string, MeshBasicNodeMaterial>();
