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

export function createLineState(data: LineData) {
  const widths = new Float32Array(lineStyleCapacity(data.paints.length) * 4), dashes = new Float32Array(widths.length);
  data.paints.forEach((paint, i) => {
    if (paint.dashArray && ![2, 4].includes(paint.dashArray.length)) throw new Error('dashArray 必须包含 2 或 4 个长度。');
    paint.dashArray?.forEach((n, j) => { dashes[i * 4 + j] = n; });
  });
  return { pixelScale: { value: 1 / 256 }, viewZoom: { value: -1 }, tileZoom: { value: -1 }, widths, dashes, data };
}

export function updateLineState(state: ReturnType<typeof createLineState>, address: Address, viewZoom: number, tileZoom: number): void {
  const updateWidths = state.viewZoom.value !== viewZoom;
  state.tileZoom.value = tileZoom;
  if (!updateWidths) return;
  state.viewZoom.value = viewZoom; state.pixelScale.value = linePixelScale(address.z, viewZoom);
  const span = WORLD / 2 ** address.z;
  const metersToTile = Math.cosh(Math.PI * (1 - 2 * (address.y + .5) / 2 ** address.z)) / span;
  state.data.paints.forEach((paint, i) => {
    state.widths[i * 4] = lineWidth(paint, viewZoom) * (paint.widthUnit === 'pixels' ? state.pixelScale.value : metersToTile);
  });
}
