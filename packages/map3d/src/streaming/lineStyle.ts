import type { LineLayerOptions } from '../types.js';
import { WEB_MERCATOR_WORLD_SIZE as WORLD } from '../spatial/mercator.js';
import type { Address } from './address.js';
import { linePixelScale, type LineData } from './lines.js';

/** Mapbox 指数插值系数，在相邻缩放 stop 之间连续求值。 */
export function lineWidth(paint: LineLayerOptions['paint'], zoom: number): number {
  const stops = paint.widthStops;
  if (!stops?.length) return paint.width ?? 1;
  if (zoom <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [z, width] = stops[i]!; const [previous, start] = stops[i - 1]!;
    if (zoom > z) continue;
    const base = paint.widthBase ?? 1;
    const t = base === 1 ? (zoom - previous) / (z - previous) : (base ** (zoom - previous) - 1) / (base ** (z - previous) - 1);
    return start + (width - start) * t;
  }
  return stops.at(-1)![1];
}

export const lineStyleCapacity = (count: number): number => count <= 32 ? 32 : count <= 64 ? 64 : 128;

/** 空线数据：槽位新建时尚未承接瓦片，避免为未使用槽位分配数据。 */
const EMPTY_LINE_DATA: LineData = { segments: new Float32Array(0), styles: new Float32Array(0), colors: new Float32Array(0), distances: new Float32Array(0), paints: [] };

export function createLineState(data: LineData) {
  return createLineSlot(lineStyleCapacity(data.paints.length), data);
}

/**
 * 线样式状态由绘制槽位持有：宽度与虚线数组一次分配后跨瓦片复用。
 * 逐瓦片重新分配数组会让 buffer 节点换掉绑定属性，进而创建新的 GPUBuffer。
 */
export function createLineSlot(capacity: number, data: LineData = EMPTY_LINE_DATA) {
  const state = { pixelScale: { value: 1 / 256 }, viewZoom: { value: -1 }, tileZoom: { value: -1 },
    widths: new Float32Array(capacity * 4), dashes: new Float32Array(capacity * 4), data };
  fillLineState(state, data);
  return state;
}

/** 就地重填槽位状态：只改写数组内容，不替换数组对象。 */
export function fillLineState(state: ReturnType<typeof createLineSlot>, data: LineData): void {
  if (data.paints.length * 4 > state.dashes.length) throw new Error('线样式数量超出槽位容量。');
  state.data = data; state.viewZoom.value = -1; state.tileZoom.value = -1; state.pixelScale.value = 1 / 256;
  state.widths.fill(0); state.dashes.fill(0);
  data.paints.forEach((paint, i) => {
    if (paint.dashArray && ![2, 4].includes(paint.dashArray.length)) throw new Error('dashArray 必须包含 2 或 4 个长度。');
    paint.dashArray?.forEach((n, j) => { state.dashes[i * 4 + j] = n; });
  });
}

export function updateLineState(state: ReturnType<typeof createLineSlot>, address: Address, viewZoom: number, tileZoom: number): void {
  const data = state.data;
  const updateWidths = state.viewZoom.value !== viewZoom;
  state.tileZoom.value = tileZoom;
  if (!updateWidths) return;
  state.viewZoom.value = viewZoom; state.pixelScale.value = linePixelScale(address.z, viewZoom);
  const span = WORLD / 2 ** address.z;
  const metersToTile = Math.cosh(Math.PI * (1 - 2 * (address.y + .5) / 2 ** address.z)) / span;
  data.paints.forEach((paint, i) => {
    state.widths[i * 4] = lineWidth(paint, viewZoom) * (paint.widthUnit === 'pixels' ? state.pixelScale.value : metersToTile);
  });
}
