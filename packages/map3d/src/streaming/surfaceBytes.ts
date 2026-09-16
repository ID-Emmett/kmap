import type { BuildingData } from './buildings.js';
import type { LineData } from './lines.js';

/** 每个绘制来源的线样式表与建筑裁剪表同时计入 CPU/GPU 预算。 */
export function surfaceStateBytes(lines?: LineData, buildings?: BuildingData): number {
  return (lines?.segments.length ? 128 * 4 * 4 * 2 : 0) + (buildings?.indices.length ? 256 * 4 * 4 : 0);
}
