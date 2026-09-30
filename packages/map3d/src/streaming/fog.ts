import { MAP_CAMERA_HALF_FOV_TANGENT, type MapCameraFrame } from '../rendering/mapCamera.js';
import type { ViewportSize } from '../types.js';

const RADIANS = Math.PI / 180;
/** 雾带收窄比例：1 为原始过渡宽度；越小过渡越窄，雾越不扩散到远处物体上。 */
export const FOG_BAND_SCALE = .4;
/** 可见雾阈值：smoothstep(t) = .98 的根，选片半径由该点位置确定。 */
export const FOG_CUTOFF_ROOT = .915962;

/** 夹逼到 [0, 1] 的平滑阶跃，用于俯仰角分段混合。 */
function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * 相机空间距离雾：完全遮挡边界同时供四叉树剔除和 TSL 使用。
 * 20° 以下是可视范围之外的远景雾，20°～45° 渐入，45° 以上继续收近，75° 时完全入雾距离位于屏幕顶部 40%。
 * 起止距离全部随俯仰角连续变化，不使用屏幕比例换算的固定窄带，
 * 因此雾随视角缓慢进入视野，不会在某个角度整屏突然出现。
 * `wide` 是收窄前的起点，供测试与调参对照。
 */
export function fogDistances(frame: MapCameraFrame, pitch: number) {
  const entrance = smoothstep01((pitch - 20) / 25), approach = smoothstep01((pitch - 45) / 30);
  // 75°、45° 视场下，中心射线在屏幕顶部 40% 处达到完全入雾距离。
  const far = Math.cos(75 * RADIANS) / Math.sin(15 * RADIANS - Math.atan(.2 * MAP_CAMERA_HALF_FOV_TANGENT));
  const end = frame.distance * (16 - 13.6 * entrance + (far - 2.4) * approach);
  const wide = frame.distance * (12 - 10.55 * entrance - .53 * approach);
  // 完全入雾位置不变，开始入雾按比例靠近它。
  return { start: end - (end - wide) * FOG_BAND_SCALE, end, wide };
}

/** 指定屏幕高度比例处地面与相机的三维距离；比例沿用 0 为屏幕顶部的约定。 */
export function fogDistanceAtScreen(frame: MapCameraFrame, pitch: number, fraction: number): number {
  const depression = 90 - pitch - Math.atan((1 - 2 * fraction) * MAP_CAMERA_HALF_FOV_TANGENT) / RADIANS;
  return frame.distance * Math.cos(pitch * RADIANS) / Math.sin(depression * RADIANS);
}

/**
 * 地面距离对应的屏幕行：0 为屏幕顶部，1 为底部。
 * 中心列的地面距离只由射线俯角决定（dep = asin(h / D)），行与俯角一一对应，
 * 因此同一距离在整个屏幕宽度上都是同一行，雾的等值线是水平线而不是以相机为圆心的圆。
 * 该函数与着色器中的行换算（屏幕行 → 该行中心列地面距离）互为反函数，二者一致性由单元测试保护。
 * 距离超出可视范围时返回屏幕外的行（小于 0 表示在屏幕上方）。
 */
export function fogRowForDistance(frame: MapCameraFrame, pitch: number, distance: number): number {
  const height = frame.distance * Math.cos(pitch * RADIANS);
  if (!(distance > height)) return 1;
  const depression = Math.asin(height / distance) / RADIANS;
  const ndc = Math.tan((90 - pitch - depression) * RADIANS) / MAP_CAMERA_HALF_FOV_TANGENT;
  return (1 - ndc) / 2;
}

/**
 * 平面雾的选片半径放大系数。
 * 同一屏幕行的边缘地面距离是中心列的 sqrt(1 + tanH²) 倍（H 为水平半视场），
 * 该比值在屏幕中间行取最大，选片半径按该系数放大后边缘在完全入雾前不会先被剔除，
 * 因此不需要弧度补偿；该上界由单元测试核对。
 */
export function fogCornerCoverage(viewport: ViewportSize): number {
  const aspect = viewport.height > 0 ? Math.max(1, viewport.width / viewport.height) : 1;
  return Math.hypot(1, MAP_CAMERA_HALF_FOV_TANGENT * aspect);
}

/** 平面包围矩形到相机的最近三维距离，跨雾边界的瓦片保留近侧。 */
export function distanceToGroundBox(x: number, z: number, span: number, camera: MapCameraFrame['position']): number {
  return Math.hypot(Math.max(x - camera.x, 0, camera.x - x - span), camera.y,
    Math.max(z - camera.z, 0, camera.z - z - span));
}
