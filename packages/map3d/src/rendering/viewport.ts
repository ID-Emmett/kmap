import type { ViewportSize } from '../types.js';

const MAX_PIXEL_RATIO = 2;

/** 将外部视口参数收敛为渲染器可安全使用的值。 */
export function normalizeViewport(size: ViewportSize): Required<ViewportSize> {
  return {
    width: normalizeDimension(size.width),
    height: normalizeDimension(size.height),
    pixelRatio: normalizePixelRatio(size.pixelRatio ?? 1),
  };
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function normalizePixelRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(MAX_PIXEL_RATIO, Math.max(1, value));
}
