import { describe, expect, it } from 'vitest';

import {
  mvtPointToTileLocalMeters,
  tilePositionToLngLat,
} from '../src/spatial/mercator.js';
import {
  getTileAnchorRelativeToOrigin,
  selectMapOrigin,
  tileLocalPointToScenePosition,
} from '../src/spatial/mapOrigin.js';
import { WEB_MERCATOR_WORLD_SIZE } from '../src/spatial/mercator.js';

describe('MapOrigin', () => {
  it('选择当前数据 Tile 中心并支持 world wrap', () => {
    const origin = selectMapOrigin({ lng: 190, lat: 0 }, 2);

    expect(origin.tileX).toBe(4);
    expect(origin.tileY).toBe(2);
    expect(origin.z).toBe(2);
  });

  it('重定位只改变 Tile 锚点相对位置，不改变局部顶点', () => {
    const zoom = 17;
    const originA = selectMapOrigin({ lng: 116.4074, lat: 39.9042 }, zoom);
    const originB = selectMapOrigin(
      tilePositionToLngLat({
        z: zoom,
        x: originA.tileX + 1.5,
        y: originA.tileY + 0.5,
      }),
      zoom,
    );
    const localPoint = mvtPointToTileLocalMeters(
      { x: 3072, y: 2048 },
      zoom,
      4096,
    );
    const anchorA = getTileAnchorRelativeToOrigin(
      originA.tileX,
      originA.tileY,
      zoom,
      originA,
    );
    const anchorB = getTileAnchorRelativeToOrigin(
      originA.tileX,
      originA.tileY,
      zoom,
      originB,
    );
    const sceneA = tileLocalPointToScenePosition(localPoint, anchorA);
    const sceneB = tileLocalPointToScenePosition(localPoint, anchorB);
    const globalA = {
      x: originA.meters.x + sceneA.x,
      y: originA.meters.y - sceneA.z,
    };
    const globalB = {
      x: originB.meters.x + sceneB.x,
      y: originB.meters.y - sceneB.z,
    };

    expect(originB.tileX).toBe(originA.tileX + 1);
    expect(anchorB).not.toEqual(anchorA);
    expect(globalB.x).toBeCloseTo(globalA.x, 8);
    expect(globalB.y).toBeCloseTo(globalA.y, 8);
  });

  it('数据 zoom 改变后仍可连续放置旧层级 Tile', () => {
    const tileZoom = 5;
    const tileX = 26;
    const tileY = 12;
    const tileCenter = tilePositionToLngLat({
      z: tileZoom,
      x: tileX + 0.5,
      y: tileY + 0.5,
    });
    const originA = selectMapOrigin(tileCenter, tileZoom);
    const originB = selectMapOrigin(tileCenter, tileZoom + 1);
    const anchorA = getTileAnchorRelativeToOrigin(
      tileX,
      tileY,
      tileZoom,
      originA,
    );
    const anchorB = getTileAnchorRelativeToOrigin(
      tileX,
      tileY,
      tileZoom,
      originB,
    );
    const globalA = {
      x: originA.meters.x + anchorA.x,
      y: originA.meters.y - anchorA.z,
    };
    const globalB = {
      x: originB.meters.x + anchorB.x,
      y: originB.meters.y - anchorB.z,
    };

    expect(originB.z).toBe(tileZoom + 1);
    expect(globalB.x).toBeCloseTo(globalA.x, 8);
    expect(globalB.y).toBeCloseTo(globalA.y, 8);
  });

  it('相邻 Tile 的世界边缘在 Float32 提交后误差小于 1 毫米', () => {
    const zoom = 15;
    const span = WEB_MERCATOR_WORLD_SIZE / 2 ** zoom;
    const origin = selectMapOrigin({ lng: 116.3946533203125, lat: 39.90552253972854 }, zoom);
    const left = getTileAnchorRelativeToOrigin(26978, 12416, zoom, origin).x;
    const right = getTileAnchorRelativeToOrigin(26979, 12416, zoom, origin).x;
    expect(Math.abs((Math.fround(left) + Math.fround(span)) - Math.fround(right))).toBeLessThanOrEqual(0.001);
  });
});
