import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { ViewportSize, ViewState } from '../types.js';

export const GLOBE_START = 4.5, GLOBE_END = 5.5;
export function globeBlend(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - GLOBE_START) / (GLOBE_END - GLOBE_START))); return t * t * (3 - 2 * t);
}
/** 球面中心、正北与相机距离使用 ViewState 的同一经纬度和连续缩放语义。 */
export function updateGlobeCamera(camera: PerspectiveCamera, view: ViewState, viewport: ViewportSize): void {
  const lng = view.center.lng * Math.PI / 180, lat = view.center.lat * Math.PI / 180;
  const center = new Vector3(Math.cos(lat) * Math.sin(lng), Math.sin(lat), Math.cos(lat) * Math.cos(lng));
  const north = new Vector3(-Math.sin(lat) * Math.sin(lng), Math.cos(lat), -Math.sin(lat) * Math.cos(lng));
  const east = new Vector3(Math.cos(lng), 0, -Math.sin(lng)), bearing = view.bearing * Math.PI / 180;
  const up = north.multiplyScalar(Math.cos(bearing)).add(east.multiplyScalar(Math.sin(bearing)));
  const aspect = viewport.width / viewport.height, halfFov = Math.PI / 8;
  const fit = 1 / Math.sin(Math.atan(Math.tan(halfFov) * Math.min(1, aspect))) / .82;
  const localAtStart = Math.PI * viewport.height * Math.cos(lat) / (256 * 2 ** GLOBE_START * Math.tan(halfFov));
  // 最低缩放保证整个球体落在短边 82% 内；城市方向的缩放渐进匹配 Mercator 比例。
  const startAltitude = Math.min(fit - 1, localAtStart);
  const distance = view.zoom <= GLOBE_START ? (fit - 1) * (startAltitude / (fit - 1)) ** (view.zoom / GLOBE_START)
    : startAltitude * 2 ** (GLOBE_START - view.zoom);
  const pitch = view.pitch * Math.PI / 180 * Math.min(1, view.zoom / GLOBE_END);
  camera.position.copy(center).addScaledVector(center, Math.cos(pitch) * distance).addScaledVector(up, -Math.sin(pitch) * distance);
  camera.up.copy(up); camera.lookAt(center); camera.fov = 45; camera.aspect = aspect; camera.near = .001; camera.far = 100;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}
