import { Vector3, Vector4, type Scene, type Node } from 'three/webgpu';
import { Fn, If, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, float, mix, modelViewMatrix, modelWorldMatrix, positionLocal, uniform, varying, vec3, vec4 } from 'three/tsl';
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
    const lng = point.x.sub(center.x).div(EARTH_RADIUS);
    const q = center.y.sub(point.z).div(EARTH_RADIUS), s0 = center.z.sin(), c0 = center.z.cos();
    const dlat = float(0).toVar();
    // 逆 Mercator 三阶局部展开与半角弓高公式避免街区坐标的浮点消减。
    If(q.abs().lessThan(.001), () => { dlat.assign(q.mul(c0).mul(float(1).sub(q.mul(s0).mul(.5)).add(q.mul(q).mul(s0.mul(s0).mul(2).sub(1)).div(6)))); })
      .Else(() => { dlat.assign(float(2).mul(origin.y.sub(point.z).div(EARTH_RADIUS).exp().atan()).sub(Math.PI / 2).sub(center.z)); });
    const cos = center.z.add(dlat).cos(), half = lng.mul(.5).sin().pow(2);
    const drop = dlat.mul(.5).sin().pow(2).add(cos.mul(c0).mul(half)).mul(-2);
    const normal = vec3(cos.mul(lng.sin()), float(1).add(drop), dlat.sin().negate().sub(cos.mul(s0).mul(half).mul(2)));
    result.assign(mix(point, vec3(normal.x.mul(origin.w).add(center.x), drop.mul(origin.w), normal.z.mul(origin.w).add(center.y)).add(normal.mul(point.y)), center.w));
  });
  return result;
});
export function mapVertex(position: Node<'vec3'>): Node<'vec4'> {
  return Fn(() => {
    // 平面分支使用 CPU 双精度合成的 modelViewMatrix，避免高倍缩放时相减消减。
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(position, 1)).toVar();
    If(center.w.greaterThan(0), () => { clip.assign(cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(projectMapPosition(modelWorldMatrix.mul(vec4(position, 1)).xyz), 1))); });
    return clip;
  })();
}
export const mapWorldPosition = varying(projectMapPosition(modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz));
/** 朝向判定按球面法线计算，片元只执行标量裁剪。 */
export const mapFacing = varying(Fn(() => {
  const point = projectMapPosition(modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz);
  return mix(1, point.sub(vec3(center.x, origin.w.negate(), center.y)).normalize().dot(cameraPosition.sub(point).normalize()), center.w);
})());
/** CPU 覆盖与文字布局使用相同的球面映射。 */
export function projectMapPoint(point: Vector3, p: ProjectionState): Vector3 {
  if (!p.center.w) return point;
  const x = point.x, y = point.y, z = point.z, weight = p.center.w;
  const lng = (point.x - p.center.x) / EARTH_RADIUS;
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
  return p.center.w < .999 || (point.x - p.center.x) * (camera.x - point.x)
    + (point.y + p.origin.w) * (camera.y - point.y) + (point.z - p.center.y) * (camera.z - point.z) > 0;
}
