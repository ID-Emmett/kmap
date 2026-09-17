import { Vector3, Vector4, type Scene, type Node } from 'three/webgpu';
import { Fn, If, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, float, mix, highpModelViewMatrix, modelWorldMatrix, positionLocal, uniform, varying, vec3, vec4, viewportSize } from 'three/tsl';
import { projectLngLat, WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import type { MapOrigin } from '../spatial/types.js';
import { globeBlend } from './globeCamera.js';
import type { ViewState } from '../types.js';

export const EARTH_RADIUS = WORLD / (2 * Math.PI);
export interface ProjectionState { center: Vector4; origin: Vector4; sinLat?: number; cosLat?: number }
const flat: ProjectionState = { center: new Vector4(), origin: new Vector4() };
const state = (scene: Scene | null): ProjectionState => scene?.userData.mapProjection ?? flat;
const center = uniform(new Vector4()).onRenderUpdate(frame => state(frame.scene).center);
const origin = uniform(new Vector4()).onRenderUpdate(frame => state(frame.scene).origin);

/** 近景使用平面坐标，低缩放通过连续权重映射到球面。 */
export function updateProjection(scene: Scene, view: ViewState, mapOrigin: MapOrigin, enabled: boolean): ProjectionState {
  const p: ProjectionState = scene.userData.mapProjection ??= { center: new Vector4(), origin: new Vector4() };
  const c = projectLngLat(view.center), lat = view.center.lat * Math.PI / 180;
  p.center.set(c.x - mapOrigin.meters.x, mapOrigin.meters.y - c.y, lat, enabled ? 1 - globeBlend(view.zoom) : 0);
  p.sinLat = Math.sin(lat); p.cosLat = Math.cos(lat);
  p.origin.set(mapOrigin.meters.x, mapOrigin.meters.y, c.x, EARTH_RADIUS / p.cosLat);
  return p;
}
export const projectMapPosition = Fn(([point]: [Node<'vec3'>]) => {
  const result = point.toVar();
  If(center.w.greaterThan(0), () => {
    const delta = point.x.sub(center.x).add(WORLD / 2).mod(WORLD).add(WORLD).mod(WORLD).sub(WORLD / 2);
    const flatPoint = vec3(center.x.add(delta), point.y, point.z);
    const lng = delta.div(EARTH_RADIUS);
    const q = center.y.sub(point.z).div(EARTH_RADIUS), s0 = center.z.sin(), c0 = center.z.cos();
    const dlat = float(0).toVar();
    // 逆 Mercator 三阶局部展开与半角弓高公式避免街区坐标的浮点消减。
    If(q.abs().lessThan(.001), () => { dlat.assign(q.mul(c0).mul(float(1).sub(q.mul(s0).mul(.5)).add(q.mul(q).mul(s0.mul(s0).mul(2).sub(1)).div(6)))); })
      .Else(() => { dlat.assign(float(2).mul(origin.y.sub(point.z).div(EARTH_RADIUS).exp().atan()).sub(Math.PI / 2).sub(center.z)); });
    const cos = center.z.add(dlat).cos(), half = lng.mul(.5).sin().pow(2);
    const drop = dlat.mul(.5).sin().pow(2).add(cos.mul(c0).mul(half)).mul(-2);
    const normal = vec3(cos.mul(lng.sin()), float(1).add(drop), dlat.sin().negate().sub(cos.mul(s0).mul(half).mul(2)));
    result.assign(mix(flatPoint, vec3(normal.x.mul(origin.w).add(center.x), drop.mul(origin.w), normal.z.mul(origin.w).add(center.y)).add(normal.mul(point.y)), center.w));
  });
  return result;
});
export function mapVertex(position: Node<'vec3'>): Node<'vec4'> {
  return Fn(() => {
    // 平面分支使用 CPU 双精度合成的 modelViewMatrix，避免高倍缩放时相减消减。
    const clip = cameraProjectionMatrix.mul(highpModelViewMatrix).mul(vec4(position, 1)).toVar();
    // 平面公共边对齐设备像素的 1/64 网格中心，稳定浮点变换后的三角形边归属。
    clip.xy.assign(clip.xy.div(clip.w).mul(viewportSize).mul(32).floor().add(.5).div(viewportSize).div(32).mul(clip.w));
    If(center.w.greaterThan(0), () => { clip.assign(cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(projectMapPosition(modelWorldMatrix.mul(vec4(position, 1)).xyz), 1))); });
    return clip;
  })();
}
export const mapWorldPosition = varying(projectMapPosition(modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz));
/** 球面法线限定过渡过程的正面地理半球，片元按连续朝向渐隐。 */
export const mapFacing = varying(Fn(() => {
  const result = float(1).toVar();
  If(center.w.greaterThan(0), () => {
    const flatPoint = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    const lng = flatPoint.x.sub(center.x).div(EARTH_RADIUS), lat = float(2).mul(origin.y.sub(flatPoint.z).div(EARTH_RADIUS).exp().atan()).sub(Math.PI / 2);
    const s = lat.sin(), c = lat.cos(), s0 = center.z.sin(), c0 = center.z.cos();
    const normal = vec3(c.mul(lng.sin()), c.mul(c0).mul(lng.cos()).add(s.mul(s0)), c.mul(s0).mul(lng.cos()).sub(s.mul(c0)));
    const spherePoint = vec3(center.x, origin.w.negate(), center.y).add(normal.mul(origin.w));
    result.assign(normal.dot(cameraPosition.sub(spherePoint).normalize()));
  });
  return result;
})());
/** CPU 覆盖与文字布局使用相同的球面映射。 */
export function projectMapPoint(point: Vector3, p: ProjectionState): Vector3 {
  if (!p.center.w) return point;
  const delta = ((point.x - p.center.x + WORLD / 2) % WORLD + WORLD) % WORLD - WORLD / 2;
  const x = p.center.x + delta, y = point.y, z = point.z, weight = p.center.w;
  const lng = delta / EARTH_RADIUS;
  const q = (p.center.y - point.z) / EARTH_RADIUS, s0 = p.sinLat ?? Math.sin(p.center.z), c0 = p.cosLat ?? Math.cos(p.center.z);
  const dlat = Math.abs(q) < .001 ? q * c0 * (1 - q * s0 / 2 + q * q * (2 * s0 * s0 - 1) / 6)
    : 2 * Math.atan(Math.exp((p.origin.y - point.z) / EARTH_RADIUS)) - Math.PI / 2 - p.center.z;
  const local = Math.abs(lng) < .001 && Math.abs(dlat) < .001;
  const sinD = local ? dlat * (1 - dlat * dlat / 6) : Math.sin(dlat);
  const cosD = local ? 1 - dlat * dlat / 2 : Math.cos(dlat);
  const sinLng = local ? lng * (1 - lng * lng / 6) : Math.sin(lng);
  const c = c0 * cosD - s0 * sinD, half = local ? lng * lng / 4 : Math.sin(lng / 2) ** 2;
  const drop = -2 * ((local ? dlat * dlat / 4 : Math.sin(dlat / 2) ** 2) + c * c0 * half), r = p.origin.w, h = point.y;
  return point.set(x + (c * sinLng * (r + h) + p.center.x - x) * weight, y + (drop * r + (1 + drop) * h - y) * weight,
    z + ((-sinD - 2 * c * s0 * half) * (r + h) + p.center.y - z) * weight);
}
export function facesCamera(point: Vector3, camera: Vector3, p: ProjectionState): boolean {
  if (!p.center.w) return true;
  const lng = (point.x - p.center.x) / EARTH_RADIUS;
  const lat = 2 * Math.atan(Math.exp((p.origin.y - point.z) / EARTH_RADIUS)) - Math.PI / 2;
  const s = Math.sin(lat), c = Math.cos(lat), s0 = Math.sin(p.center.z), c0 = Math.cos(p.center.z);
  const nx = c * Math.sin(lng), ny = c * c0 * Math.cos(lng) + s * s0, nz = c * s0 * Math.cos(lng) - s * c0;
  return nx * (camera.x - p.center.x) + ny * (camera.y + p.origin.w) + nz * (camera.z - p.center.y) > p.origin.w;
}
