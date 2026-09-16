import { projectMapPosition } from '../globe/projection.js';
import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector2, Vector3 } from 'three/webgpu';
import { Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, float, fwidth, max, mix, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import { GLYPH_RANGE } from './glyphs.js';
import type { GlyphAtlas } from './glyphAtlas.js';

export interface GlyphQuad { x: number; y: number; left: number; top: number; width: number; height: number; u: number; v: number; du: number; dv: number; angle: number; endX?: number | undefined; endY?: number | undefined; color: string | number; haloColor: string | number; haloWidth: number; scale: number; born: number }
/** 全屏文字使用一个实例批次；地图锚点随相机逐帧投影，字形尺寸按 CSS 像素计算。 */
export class LabelSurface {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshBasicNodeMaterial>;
  readonly origin = uniform(new Vector3()); readonly viewport = uniform(new Vector2(1, 1));
  readonly clock = uniform(0);
  readonly capacity = 8192; count = 0;
  constructor(atlas: GlyphAtlas) {
    const geometry = new InstancedBufferGeometry(), plane = new PlaneGeometry(1, 1);
    geometry.index = plane.index; geometry.attributes = plane.attributes; geometry.instanceCount = 0;
    for (const [name, size] of [['labelAnchor', 2], ['labelDirection', 3], ['labelRect', 4], ['labelUV', 4], ['labelStyle', 4], ['labelColor', 3], ['labelHalo', 3]] as const)
      geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(this.capacity * size), size).setUsage(DynamicDrawUsage));
    const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false });
    const rect = attribute<'vec4'>('labelRect', 'vec4'), anchor = attribute<'vec2'>('labelAnchor', 'vec2');
    const style = varying(attribute<'vec4'>('labelStyle', 'vec4')).setInterpolation('flat');
    const glyphUV = attribute<'vec4'>('labelUV', 'vec4');
    material.vertexNode = Fn(() => {
      const matrix = cameraProjectionMatrix.mul(cameraViewMatrix);
      const clip = matrix.mul(vec4(projectMapPosition(vec3(anchor.x.sub(this.origin.x), 0, anchor.y.sub(this.origin.z))), 1)).toVar();
      const direction = attribute<'vec3'>('labelDirection', 'vec3');
      const end = matrix.mul(vec4(projectMapPosition(vec3(direction.x.sub(this.origin.x), 0, direction.y.sub(this.origin.z))), 1));
      const delta = end.xy.div(end.w).sub(clip.xy.div(clip.w)).mul(this.viewport).mul(vec2(1, -1));
      const tangent = delta.div(max(delta.length(), .00001)).mul(delta.x.lessThan(0).select(-1, 1));
      const pixel = vec2(rect.x.add(uv().x.mul(rect.z)), rect.y.add(float(1).sub(uv().y).mul(rect.w)));
      const c = direction.z.greaterThan(0).select(tangent.x, 1), s = direction.z.greaterThan(0).select(tangent.y, 0);
      const offset = vec2(pixel.x.mul(c).sub(pixel.y.mul(s)), pixel.x.mul(s).add(pixel.y.mul(c)));
      return vec4(clip.xy.add(offset.mul(vec2(2, -2)).div(this.viewport).mul(clip.w)), 0, clip.w);
    })();
    material.colorNode = Fn(() => {
      const sdf = texture(atlas.texture, glyphUV.xy.add(vec2(uv().x, float(1).sub(uv().y)).mul(glyphUV.zw))).r;
      const aa = max(fwidth(sdf).mul(.65), .015).toVar();
      const ink = smoothstep(float(.75).sub(aa), float(.75).add(aa), sdf);
      const threshold = float(.75).sub(style.y.div(style.z.mul(GLYPH_RANGE)));
      const halo = smoothstep(threshold.sub(aa), threshold.add(aa), sdf);
      halo.lessThan(.01).discard();
      return vec4(mix(attribute<'vec3'>('labelHalo', 'vec3'), attribute<'vec3'>('labelColor', 'vec3'), ink), halo.mul(smoothstep(0, .16, this.clock.sub(style.w))));
    })();
    this.mesh = new Mesh(geometry, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10;
  }
  write(quads: readonly GlyphQuad[]): void {
    const geometry = this.mesh.geometry; this.count = Math.min(this.capacity, quads.length);
    const color = new Color();
    for (let i = 0; i < this.count; i++) {
      const q = quads[i]!;
      const set = (name: string, values: number[]) => { (geometry.getAttribute(name).array as Float32Array).set(values, i * values.length); };
      set('labelAnchor', [q.x, q.y]); set('labelDirection', [q.endX ?? q.x, q.endY ?? q.y, q.endX === undefined ? 0 : 1]); set('labelRect', [q.left, q.top, q.width, q.height]); set('labelUV', [q.u, q.v, q.du, q.dv]);
      set('labelStyle', [q.angle, q.haloWidth, q.scale, q.born]); color.set(q.color); set('labelColor', [color.r, color.g, color.b]);
      color.set(q.haloColor); set('labelHalo', [color.r, color.g, color.b]);
    }
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (!name.startsWith('label')) continue;
      const buffer = attribute as InstancedBufferAttribute;
      buffer.clearUpdateRanges(); buffer.addUpdateRange(0, this.count * buffer.itemSize); buffer.needsUpdate = true;
    }
    geometry.instanceCount = this.count; this.mesh.visible = this.count > 0;
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
