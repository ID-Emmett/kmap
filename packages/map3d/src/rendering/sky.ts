import { Color, Vector3, type Node, type PerspectiveCamera } from 'three/webgpu';
import { clamp, fog, max, min, mix, positionWorld, pow, renderGroup, screenUV, smoothstep, uniform, vec4 } from 'three/tsl';
import { MAP_CAMERA_HALF_FOV_TANGENT } from './mapCamera.js';
import type { MapTheme } from '../types.js';

/** SDK 缺省天顶色：主题未配置 skyZenithColor 时使用的蓝色系默认值。 */
export const DEFAULT_SKY_ZENITH_COLOR = '#4a90d9';
/** 可见天空的渐变指数：数值越小蓝天空色进入越早，用于避免底边附近出现大片单色浅雾带。 */
const SKY_GRADIENT_POWER = .8;
/** 底边色向天顶色的固定混合比例：压掉纯背景色在过渡带形成的亮光带。 */
const HAZE_TINT = .35;
/** 边界非正（屏幕内没有天空）时保持地平线色的除数下限。 */
const BOUNDARY_DIVISOR_FLOOR = 1e-4;
/** 屏幕行换算地面距离时的除零下限。 */
const ROW_FLOOR = 1e-4;

/** 解析主题的天空颜色：地平线色与雾末端色共用 `fogColor ?? backgroundColor`，天顶色省略时使用 SDK 默认值。 */
export function resolveSkyColors(theme: Pick<MapTheme, 'backgroundColor' | 'fogColor' | 'skyZenithColor'>): { horizon: string | number; zenith: string | number } {
  return { horizon: theme.fogColor ?? theme.backgroundColor, zenith: theme.skyZenithColor ?? DEFAULT_SKY_ZENITH_COLOR };
}

/**
 * 天空背景与远景雾的统一状态。
 *
 * 场景背景和雾末端色共用同一个渐变节点：极远处内容收敛到当前屏幕位置的天空色，
 * 因此内容边界与天空之间没有色缝，远景内容在进入纯天空区域前连续淡出。
 * 雾取相机距离与屏幕行地面距离的较小值：近处物体按自身距离计算不被吞掉，
 * 同一屏幕行整行一致，等值线是与地平线平行的水平线。天空可见底边取完全入雾行，
 * 与数学地平线无关，并随视角逐帧移动。
 */
export class MapSky {
  /** 地平线色：解析后的 fogColor ?? backgroundColor，即雾末端色。 */
  readonly horizon = uniform(new Color('#f5f5f2')).setGroup(renderGroup);
  /** 天顶色：主题 skyZenithColor 或 SDK 默认蓝色。 */
  readonly zenith = uniform(new Color(DEFAULT_SKY_ZENITH_COLOR)).setGroup(renderGroup);
  /** 天空可见底边的屏幕高度比例：0 为屏幕顶部，1 为底部；非正数表示屏幕内没有天空。 */
  readonly boundary = uniform(0).setGroup(renderGroup);
  /** 远景雾的相机位置、开始距离与完全吞没距离；地面、瓦片、建筑和影像共用。 */
  readonly fogCenter = uniform(new Vector3()).setGroup(renderGroup);
  readonly fogStart = uniform(1).setGroup(renderGroup);
  readonly fogEnd = uniform(2).setGroup(renderGroup);
  /** 视轴倾角的正弦与余弦、相机离地高度：把片元屏幕行换算成该行中心列的地面距离。 */
  readonly axisSin = uniform(1).setGroup(renderGroup);
  readonly axisCos = uniform(0).setGroup(renderGroup);
  readonly viewHeight = uniform(1).setGroup(renderGroup);
  /** 雾末端与天空底边共用的颜色：地平线色向天顶色混合，避免纯背景色形成亮光带。 */
  readonly floor = uniform(new Color('#f5f5f2')).setGroup(renderGroup);
  /** 可见天空颜色：底边 haze 色连续渐变到屏幕顶部天顶色。 */
  readonly colorNode: Node<'vec3'>;
  /** 场景背景节点：可见天空由该节点填充，近处内容按正常顺序遮挡天空。 */
  readonly backgroundNode: Node<'vec4'>;
  /** 场景雾节点：完全入雾处收敛到同一渐变颜色。 */
  readonly fogNode: Node<'vec4'>;
  private readonly forward = new Vector3();

  constructor(horizon: Color | string | number) {
    this.horizon.value.set(horizon); this.setHaze();
    const skyAmount = clamp(this.boundary.sub(screenUV.y).div(max(this.boundary, BOUNDARY_DIVISOR_FLOOR)), 0, 1);
    this.colorNode = mix(this.floor, this.zenith, pow(skyAmount, SKY_GRADIENT_POWER));
    this.backgroundNode = vec4(this.colorNode, 1);
    // 雾取相机距离与屏幕行换算地面距离的较小值：近处高楼不会因为屏幕位置高而被当成远景吞掉，
    // 同一屏幕行的地面距离一致，因此过渡线仍是水平线，不出现以相机为圆心的圆弧。
    const tangent = screenUV.y.mul(-2).add(1).mul(MAP_CAMERA_HALF_FOV_TANGENT);
    const rowDistance = this.viewHeight.mul(tangent.mul(tangent).add(1).sqrt())
      .div(max(this.axisSin.sub(this.axisCos.mul(tangent)), ROW_FLOOR));
    this.fogNode = fog(this.colorNode, smoothstep(this.fogStart, this.fogEnd,
      min(rowDistance, positionWorld.sub(this.fogCenter).length())));
  }

  /** 主题颜色变化时同步地平线色与天顶色；雾末端色取两者的固定混合。 */
  setColors(horizon: Color | string | number, zenith: Color | string | number): void {
    this.horizon.value.set(horizon); this.zenith.value.set(zenith); this.setHaze();
  }

  /** 每帧写入雾参数与完全入雾行；天空底边取该行。 */
  update(camera: PerspectiveCamera, fogStart: number, fogEnd: number, rowEnd: number): void {
    this.fogCenter.value.copy(camera.position); this.fogStart.value = fogStart; this.fogEnd.value = fogEnd;
    this.viewHeight.value = camera.position.y;
    camera.getWorldDirection(this.forward);
    // 视轴俯角的正弦与余弦：axisSin = cos(pitch)，axisCos = sin(pitch)。
    this.axisSin.value = Math.max(-this.forward.y, ROW_FLOOR);
    this.axisCos.value = Math.hypot(this.forward.x, this.forward.z);
    this.boundary.value = Math.min(1, Math.max(0, rowEnd));
  }

  /** 当前天空状态；供诊断和证据读取。 */
  getState(): { boundary: number; horizon: string; zenith: string; floor: string; fogStart: number; fogEnd: number } {
    return { boundary: this.boundary.value, horizon: `#${this.horizon.value.getHexString()}`, zenith: `#${this.zenith.value.getHexString()}`,
      floor: `#${this.floor.value.getHexString()}`, fogStart: this.fogStart.value, fogEnd: this.fogEnd.value };
  }

  private setHaze(): void {
    this.floor.value.copy(this.horizon.value).lerp(this.zenith.value, HAZE_TINT);
  }
}


