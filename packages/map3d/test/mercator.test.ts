import { describe, expect, it } from 'vitest';

import {
  getTileAnchorMeters,
  getTileSpanMeters,
  lngLatToTilePosition,
  mvtPointToTileLocalMeters,
  projectLngLat,
  tileLocalMetersToMvtPoint,
  tilePositionToLngLat,
  unprojectMercator,
  WEB_MERCATOR_HALF_WORLD_SIZE,
  WEB_MERCATOR_MAX_LATITUDE,
} from '../src/spatial/mercator.js';

describe('Web Mercator', () => {
  it.each([
    { lng: 0, lat: 0 },
    { lng: 116.4074, lat: 39.9042 },
    { lng: -180, lat: 0 },
    { lng: 180, lat: 0 },
    { lng: 121.4737, lat: WEB_MERCATOR_MAX_LATITUDE },
    { lng: -74.006, lat: -WEB_MERCATOR_MAX_LATITUDE },
  ])('经纬度投影往返 %#', (lngLat) => {
    const restored = unprojectMercator(projectLngLat(lngLat));

    expect(restored.lng).toBeCloseTo(lngLat.lng, 10);
    expect(restored.lat).toBeCloseTo(lngLat.lat, 10);
  });

  it('在投影入口限制 Mercator 纬度边界', () => {
    expect(projectLngLat({ lng: 0, lat: 90 }).y).toBeCloseTo(
      WEB_MERCATOR_HALF_WORLD_SIZE,
      6,
    );
    expect(projectLngLat({ lng: 0, lat: -90 }).y).toBeCloseTo(
      -WEB_MERCATOR_HALF_WORLD_SIZE,
      6,
    );
  });

  it('保留日期线两侧的连续 world wrap Tile 坐标', () => {
    expect(lngLatToTilePosition({ lng: -180, lat: 0 }, 2)).toEqual({
      z: 2,
      x: 0,
      y: 2,
    });
    expect(lngLatToTilePosition({ lng: 180, lat: 0 }, 2)).toEqual({
      z: 2,
      x: 4,
      y: 2,
    });

    const restored = tilePositionToLngLat({ z: 18, x: 215_828.5, y: 99_332.5 });
    const position = lngLatToTilePosition(restored, 18);

    expect(position.x).toBeCloseTo(215_828.5, 8);
    expect(position.y).toBeCloseTo(99_332.5, 8);
  });
});

describe('MVT Tile 局部米坐标', () => {
  it('转换 extent 边界并可逆', () => {
    const zoom = 15;
    const span = getTileSpanMeters(zoom);

    expect(mvtPointToTileLocalMeters({ x: 0, y: 0 }, zoom, 4096)).toEqual({
      x: 0,
      y: -0,
    });
    expect(
      mvtPointToTileLocalMeters({ x: 4096, y: 4096 }, zoom, 4096),
    ).toEqual({ x: span, y: -span });
    expect(
      tileLocalMetersToMvtPoint({ x: span / 4, y: -span / 2 }, zoom, 4096),
    ).toEqual({ x: 1024, y: 2048 });
  });

  it('相邻 Tile 的东西和南北接缝使用同一全局米坐标', () => {
    const zoom = 12;
    const x = 3372;
    const y = 1552;
    const rightEdge = mvtPointToTileLocalMeters(
      { x: 4096, y: 1536 },
      zoom,
      4096,
    );
    const nextLeftEdge = mvtPointToTileLocalMeters(
      { x: 0, y: 1536 },
      zoom,
      4096,
    );
    const bottomEdge = mvtPointToTileLocalMeters(
      { x: 1024, y: 4096 },
      zoom,
      4096,
    );
    const nextTopEdge = mvtPointToTileLocalMeters(
      { x: 1024, y: 0 },
      zoom,
      4096,
    );
    const anchor = getTileAnchorMeters(x, y, zoom);
    const eastAnchor = getTileAnchorMeters(x + 1, y, zoom);
    const southAnchor = getTileAnchorMeters(x, y + 1, zoom);

    expect(anchor.x + rightEdge.x).toBeCloseTo(
      eastAnchor.x + nextLeftEdge.x,
      8,
    );
    expect(anchor.y + rightEdge.y).toBeCloseTo(
      eastAnchor.y + nextLeftEdge.y,
      8,
    );
    expect(anchor.x + bottomEdge.x).toBeCloseTo(
      southAnchor.x + nextTopEdge.x,
      8,
    );
    expect(anchor.y + bottomEdge.y).toBeCloseTo(
      southAnchor.y + nextTopEdge.y,
      8,
    );
  });
});
