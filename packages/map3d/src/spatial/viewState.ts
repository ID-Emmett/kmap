import type { ViewState } from '../types.js';
import { clampMercatorLatitude } from './mercator.js';
import { requireFiniteNumber } from './validation.js';

export const DEFAULT_VIEW_STATE: Readonly<ViewState> = Object.freeze({
  center: Object.freeze({ lng: 0, lat: 0 }),
  zoom: 0,
  bearing: 0,
  pitch: 0,
});

/** 将角度归一化到 [0, 360)。 */
export function normalizeBearing(bearing: number): number {
  const value = requireFiniteNumber(bearing, 'bearing') % 360;
  return value < 0 ? value + 360 : value;
}

/** 将公共 ViewState 收敛到 MVP 坐标和角度约束。 */
export function normalizeViewState(
  view: Partial<ViewState>,
  fallback: ViewState = DEFAULT_VIEW_STATE,
): ViewState {
  const center = view.center ?? fallback.center;

  return {
    center: {
      lng: requireFiniteNumber(center.lng, 'center.lng'),
      lat: clampMercatorLatitude(center.lat),
    },
    zoom: Math.max(
      0,
      requireFiniteNumber(view.zoom ?? fallback.zoom, 'zoom'),
    ),
    bearing: normalizeBearing(view.bearing ?? fallback.bearing),
    pitch: Math.min(
      60,
      Math.max(
        0,
        requireFiniteNumber(view.pitch ?? fallback.pitch, 'pitch'),
      ),
    ),
  };
}
