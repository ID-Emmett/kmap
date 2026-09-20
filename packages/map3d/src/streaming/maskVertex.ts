import { Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, float, max, uniform, uv, vec2, vec3, vec4, viewportSize } from 'three/tsl';
import { projectMapPosition } from '../globe/projection.js';

/** 保守模板栅格化：覆盖半个设备像素的采样边界，父子模板的覆盖顺序决定唯一归属。 */
export function maskVertex() {
  const span = uniform(1).onObjectUpdate(({ object }) => object!.userData.maskSpan as number);
  return Fn(() => {
    const p = attribute<'vec3'>('maskPosition', 'vec3');
    const matrix = cameraProjectionMatrix.mul(cameraViewMatrix);
    const clip = matrix.mul(vec4(projectMapPosition(p), 1)).toVar();
    const x = matrix.mul(vec4(projectMapPosition(p.add(vec3(float(1).sub(uv().x.mul(2)).mul(span), 0, 0))), 1));
    const y = matrix.mul(vec4(projectMapPosition(p.add(vec3(0, 0, float(1).sub(uv().y.mul(2)).mul(span)))), 1));
    const a = x.xy.div(x.w).sub(clip.xy.div(clip.w)).mul(viewportSize).normalize();
    const b = y.xy.div(y.w).sub(clip.xy.div(clip.w)).mul(viewportSize).normalize();
    const n = vec2(a.y.negate(), a.x), m = vec2(b.y.negate(), b.x);
    const outwardN = n.mul(n.dot(b).greaterThan(0).select(-1, 1));
    const outwardM = m.mul(m.dot(a).greaterThan(0).select(-1, 1));
    const offset = outwardN.add(outwardM).div(max(float(1).add(outwardN.dot(outwardM)), .02));
    clip.xy.addAssign(offset.div(viewportSize).mul(clip.w));
    return clip;
  })();
}
