import { describe, expect, it } from 'vitest';

import { WEB_MERCATOR_MAX_LATITUDE } from '../src/spatial/mercator.js';
import {
  DEFAULT_VIEW_STATE,
  normalizeBearing,
  normalizeViewState,
} from '../src/spatial/viewState.js';

describe('ViewState', () => {
  it('归一化 zoom、bearing、pitch 和中心纬度', () => {
    expect(
      normalizeViewState({
        center: { lng: 540, lat: 90 },
        zoom: -2,
        bearing: -450,
        pitch: 80,
      }),
    ).toEqual({
      center: { lng: 540, lat: WEB_MERCATOR_MAX_LATITUDE },
      zoom: 0,
      bearing: 270,
      pitch: 75,
    });
  });

  it('使用已有状态补全局部更新且不共享可变 center', () => {
    const fallback = normalizeViewState({
      center: { lng: 116.4, lat: 39.9 },
      zoom: 12,
      bearing: 30,
      pitch: 20,
    });
    const normalized = normalizeViewState({ bearing: 390 }, fallback);

    expect(normalized).toEqual({
      center: { lng: 116.4, lat: 39.9 },
      zoom: 12,
      bearing: 30,
      pitch: 20,
    });
    expect(normalized.center).not.toBe(fallback.center);
    expect(normalizeBearing(360)).toBe(0);
    expect(DEFAULT_VIEW_STATE).toEqual({
      center: { lng: 0, lat: 0 },
      zoom: 0,
      bearing: 0,
      pitch: 0,
    });
  });

  it('拒绝非有限公共数值', () => {
    expect(() => normalizeViewState({ zoom: Number.NaN })).toThrow(
      'zoom 必须是有限数值',
    );
    expect(() =>
      normalizeViewState({ center: { lng: Number.POSITIVE_INFINITY, lat: 0 } }),
    ).toThrow('center.lng 必须是有限数值');
  });
});
