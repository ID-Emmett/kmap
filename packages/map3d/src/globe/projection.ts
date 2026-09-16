import { Vector3, Vector4, type Scene, type Node } from 'three/webgpu';
import { Fn, If, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, float, mix, modelWorldMatrix, positionLocal, uniform, varying, vec3, vec4 } from 'three/tsl';
import { projectLngLat, WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import type { MapOrigin } from '../spatial/types.js';
import type { ViewState } from '../types.js';
import { globeBlend } from './globeCamera.js';

export const EARTH_RADIUS = WORLD / (2 * Math.PI);
export interface ProjectionState { center: Vector4; origin: Vector4 }
const flat: ProjectionState = { center: new Vector4(), origin: new Vector4() };
const state = (scene: Scene | null): ProjectionState => scene?.userData.mapProjection ?? flat;
const center = uniform(new Vector4()).onRenderUpdate(frame => state(frame.scene).center);
const origin = uniform(new Vector4()).onRenderUpdate(frame => state(frame.scene).origin);

/** 所有瓦片在同一场景中按球面权重投影，城市坐标保持浮动原点精度。 */
export function updateProjection(scene: Scene, view: ViewState, mapOrigin: MapOrigin, enabled: boolean): ProjectionState {
  const p: ProjectionState = scene.userData.mapProjection ??= { center: new Vector4(), origin: new Vector4() };
  const c = projectLngLat(view.center), lat = view.center.lat * Math.PI / 180;
  p.center.set(c.x - mapOrigin.meters.x, mapOrigin.meters.y - c.y, lat, enabled ? 1 - globeBlend(view.zoom) : 0);
  p.origin.set(mapOrigin.meters.x, mapOrigin.meters.y, c.x, EARTH_RADIUS / Math.cos(lat));
  return p;
}

export const projectMapPosition = Fn(([point]: [Node<'vec3'>]) => {
  const result = point.toVar();
  If(center.w.greaterThan(0), () => {
    const lng = point.x.add(origin.x).sub(origin.z).div(EARTH_RADIUS).add(Math.PI).mod(2 * Math.PI).sub(Math.PI);
    const lat = float(2).mul(origin.y.sub(point.z).div(EARTH_RADIUS).exp().atan()).sub(Math.PI / 2);
    const cos = lat.cos(), sin = lat.sin(), radius = origin.w;
    const sphere = vec3(cos.mul(lng.sin()), sin.mul(center.z.sin()).add(cos.mul(center.z.cos()).mul(lng.cos())).sub(1),
      cos.mul(center.z.sin()).mul(lng.cos()).sub(sin.mul(center.z.cos()))).mul(radius).add(vec3(center.x, point.y, center.y));
    result.assign(mix(vec3(lng.mul(EARTH_RADIUS).add(center.x), point.y, point.z), sphere, center.w));
  });
  return result;
});

export function mapVertex(position: Node<'vec3'>): Node<'vec4'> {
  return Fn(() => {
    const world = modelWorldMatrix.mul(vec4(position, 1)).xyz;
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(projectMapPosition(world), 1));
  })();
}
/** 顶点阶段求球面可见性，片元仅执行一次标量裁剪。 */
export const mapFacing = varying(Fn(() => {
  const point = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
  const value = float(1).toVar();
  If(center.w.greaterThan(0), () => {
    const lng = point.x.add(origin.x).sub(origin.z).div(EARTH_RADIUS);
    const lat = float(2).mul(origin.y.sub(point.z).div(EARTH_RADIUS).exp().atan()).sub(Math.PI / 2);
    const normal = vec3(lat.cos().mul(lng.sin()), lat.sin().mul(center.z.sin()).add(lat.cos().mul(center.z.cos()).mul(lng.cos())),
      lat.cos().mul(center.z.sin()).mul(lng.cos()).sub(lat.sin().mul(center.z.cos())));
    const surface = normal.mul(origin.w).add(vec3(center.x, origin.w.negate(), center.y));
    value.assign(normal.dot(cameraPosition.sub(surface).normalize()));
  });
  return value;
})());

/** CPU 布局和可见集使用与 GPU 相同的球面映射。 */
export function projectMapPoint(point: Vector3, p: ProjectionState): Vector3 {
  if (!p.center.w) return point;
  const raw = (point.x + p.origin.x - p.origin.z) / EARTH_RADIUS;
  const lng = ((raw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const lat = 2 * Math.atan(Math.exp((p.origin.y - point.z) / EARTH_RADIUS)) - Math.PI / 2;
  const c = Math.cos(lat), s = Math.sin(lat), c0 = Math.cos(p.center.z), s0 = Math.sin(p.center.z), r = p.origin.w, t = p.center.w;
  return point.set((lng * EARTH_RADIUS + p.center.x) * (1 - t) + (r * c * Math.sin(lng) + p.center.x) * t,
    point.y + r * (s * s0 + c * c0 * Math.cos(lng) - 1) * t,
    point.z * (1 - t) + (r * (c * s0 * Math.cos(lng) - s * c0) + p.center.y) * t);
}

export function facesCamera(point: Vector3, camera: Vector3, p: ProjectionState): boolean {
  return p.center.w < .999 || (point.x - p.center.x) * (camera.x - point.x)
    + (point.y + p.origin.w) * (camera.y - point.y) + (point.z - p.center.y) * (camera.z - point.z) > 0;
}
