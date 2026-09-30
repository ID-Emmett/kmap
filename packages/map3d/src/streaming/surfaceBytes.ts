import { lineStyleCapacity } from './lineStyle.js';
import type { BuildingData } from './buildings.js';
import type { LineData } from './lines.js';

export function lineQuadBytes(lines?: LineData): number {
  return lines?.segments.length ? 4 * (3 + 2) * Float32Array.BYTES_PER_ELEMENT + 6 * Uint16Array.BYTES_PER_ELEMENT : 0;
}

/** 每个绘制来源的线样式表与建筑裁剪表同时计入 CPU/GPU 预算。 */
export function surfaceStateBytes(lines?: LineData, buildings?: BuildingData): number {
  return (lines?.segments.length ? lineStyleCapacity(lines.paints.length) * 4 * 4 * 2 : 0) + (buildings?.indices.length ? 256 * 4 * 4 : 0);
}
