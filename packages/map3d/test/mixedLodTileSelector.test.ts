import {
  PerspectiveCamera,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import {
  intersectCameraRayWithGround,
  sceneGroundToMercator,
  updateMapCamera,
} from '../src/rendering/mapCamera.js';
import { normalizeVectorTileSourceOptions } from '../src/source/vectorTileSource.js';
import {
  calculateProjectedTileSize,
  tileIntersectsCameraFrustum,
} from '../src/spatial/mixedLodTileGeometry.js';
import {
  lngLatToTilePosition,
} from '../src/spatial/mercator.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { calculateTileCoverage } from '../src/spatial/tileCoverage.js';
import type { TileCoverageEntry } from '../src/spatial/tileCoverage.js';
import { createRenderTileKey } from '../src/spatial/tileKey.js';
import type { MercatorPoint, RenderTileKey } from '../src/spatial/types.js';
import type { ViewportSize, ViewState } from '../src/types.js';

const CENTER = {
  lng: 116.3946533203125,
  lat: 39.90552253972854,
} as const;
const SOURCE = normalizeVectorTileSourceOptions({
  id: 'main',
  tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  minZoom: 0,
  maxZoom: 17,
});

describe('Mixed-LOD tile selector', () => {
  it('高倾角超宽场景在默认预算内保持完整 mixed LOD Coverage', () => {
    const view: ViewState = {
      center: CENTER,
      zoom: 15,
      bearing: 0,
      pitch: 60,
    };
    const viewport = { width: 2555, height: 1385 };
    const coverage = calculateTileCoverage(view, viewport, SOURCE);
    const zooms = new Set(
      coverage.visible.map((entry) => entry.key.canonical.z),
    );

    expect(coverage.diagnostics.candidateCount).toBeGreaterThan(300);
    expect(coverage.visible.length).toBeLessThanOrEqual(128);
    expect(coverage.diagnostics.budgetExceeded).toBe(false);
    expect(coverage.diagnostics.budgetLimited).toBe(true);
    expect(zooms.size).toBeGreaterThan(1);
    expect(Math.max(...zooms)).toBe(15);
    expect(Math.min(...zooms)).toBeLessThan(15);
    expectCoverageSamples(view, viewport, coverage.visible, coverage.maxGroundDistance);
    expectNoParentChildOverlap(coverage.visible);
    expectNeighborZoomContinuity(coverage.visible, 1);
  });

  it.each([
    [0, 0, 1920, 1080],
    [0, 45, 1920, 1080],
    [0, 90, 2555, 1080],
    [40, 0, 1920, 1080],
    [40, 45, 2555, 1080],
    [40, 90, 2555, 1385],
    [60, 0, 1920, 1080],
    [60, 45, 2555, 1080],
    [60, 90, 2555, 1385],
  ])(
    'pitch %i bearing %i viewport %ix%i 的屏幕采样均有 selected ancestor 覆盖',
    (pitch, bearing, width, height) => {
      const view: ViewState = {
        center: CENTER,
        zoom: 15,
        bearing,
        pitch,
      };
      const viewport = { width, height };
      const coverage = calculateTileCoverage(view, viewport, SOURCE);

      expect(coverage.visible.length).toBeLessThanOrEqual(128);
      expectCoverageSamples(
        view,
        viewport,
        coverage.visible,
        coverage.maxGroundDistance,
      );
      expectNoParentChildOverlap(coverage.visible);
    },
  );

  it('Tile AABB Frustum 与 projected size 随父子层级单调', () => {
    const view: ViewState = {
      center: CENTER,
      zoom: 15,
      bearing: 25,
      pitch: 40,
    };
    const viewport = { width: 1280, height: 720 };
    const origin = selectMapOrigin(view.center, 15);
    const camera = new PerspectiveCamera();
    updateMapCamera(camera, view, viewport, origin);
    const position = lngLatToTilePosition(view.center, 15);
    const child = requireRenderKey(
      15,
      Math.floor(position.x),
      Math.floor(position.y),
    );
    const parent = requireRenderKey(
      14,
      Math.floor(position.x / 2),
      Math.floor(position.y / 2),
    );
    const far = requireRenderKey(
      15,
      Math.floor(position.x) + 200,
      Math.floor(position.y),
    );

    expect(tileIntersectsCameraFrustum(camera, origin, child)).toBe(true);
    expect(tileIntersectsCameraFrustum(camera, origin, far)).toBe(false);
    expect(calculateProjectedTileSize(camera, viewport, origin, parent)).toBeGreaterThan(
      calculateProjectedTileSize(camera, viewport, origin, child),
    );
  });

  it('等价焦距像素在不同 FOV 与 viewport 下保持 projected size', () => {
    const view: ViewState = {
      center: CENTER,
      zoom: 15,
      bearing: 25,
      pitch: 40,
    };
    const viewport = { width: 1280, height: 720 };
    const origin = selectMapOrigin(view.center, 15);
    const camera = new PerspectiveCamera();
    updateMapCamera(camera, view, viewport, origin);
    const position = lngLatToTilePosition(view.center, 15);
    const key = requireRenderKey(
      15,
      Math.floor(position.x),
      Math.floor(position.y),
    );
    const equivalentCamera = camera.clone();
    const equivalentHeight = 1004;
    const viewportScale = equivalentHeight / viewport.height;
    const equivalentViewport = {
      width: Math.round(viewport.width * viewportScale),
      height: equivalentHeight,
    };
    equivalentCamera.fov =
      (360 / Math.PI) *
      Math.atan(
        viewportScale * Math.tan((camera.fov * Math.PI) / 360),
      );
    equivalentCamera.aspect =
      equivalentViewport.width / equivalentViewport.height;
    equivalentCamera.updateProjectionMatrix();

    expect(
      calculateProjectedTileSize(
        equivalentCamera,
        equivalentViewport,
        origin,
        key,
      ),
    ).toBeCloseTo(
      calculateProjectedTileSize(camera, viewport, origin, key),
      10,
    );
  });

  it('数量预算降低时回退到父 Tile 而不产生采样空洞', () => {
    const view: ViewState = {
      center: CENTER,
      zoom: 15,
      bearing: 45,
      pitch: 60,
    };
    const viewport = { width: 1920, height: 1080 };
    const full = calculateTileCoverage(view, viewport, SOURCE, { maxTiles: 128 });
    const limited = calculateTileCoverage(view, viewport, SOURCE, { maxTiles: 32 });
    const fullMinimum = Math.min(
      ...full.visible.map((entry) => entry.key.canonical.z),
    );
    const limitedMinimum = Math.min(
      ...limited.visible.map((entry) => entry.key.canonical.z),
    );

    expect(limited.visible.length).toBeLessThanOrEqual(32);
    expect(limitedMinimum).toBeLessThanOrEqual(fullMinimum);
    expectCoverageSamples(
      view,
      viewport,
      limited.visible,
      limited.maxGroundDistance,
    );
  });

  it('迟滞在 refine/coarsen 阈值之间保留上一帧细分', () => {
    const view: ViewState = {
      center: CENTER,
      zoom: 15,
      bearing: 0,
      pitch: 0,
    };
    const viewport = { width: 256, height: 256 };
    const coarse = calculateTileCoverage(view, viewport, SOURCE, {
      refineThresholdPixels: 600,
      coarsenThresholdPixels: 200,
    });
    const refined = calculateTileCoverage(view, viewport, SOURCE, {
      refineThresholdPixels: 400,
      coarsenThresholdPixels: 200,
    });
    const held = calculateTileCoverage(view, viewport, SOURCE, {
      previousVisible: refined.visible,
      refineThresholdPixels: 600,
      coarsenThresholdPixels: 200,
    });

    expect(maxSelectedZoom(coarse.visible)).toBeLessThan(
      maxSelectedZoom(refined.visible),
    );
    expect(maxSelectedZoom(held.visible)).toBe(maxSelectedZoom(refined.visible));
  });

  it('reference zoom 与 mixed canonical LOD 解耦', () => {
    const coverage = calculateTileCoverage(
      { center: CENTER, zoom: 15.8, bearing: 0, pitch: 60 },
      { width: 2555, height: 1385 },
      SOURCE,
    );

    expect(coverage.referenceZoom).toBe(15);
    expect(coverage.origin.z).toBe(15);
    expect(
      coverage.visible.some(
        (entry) => entry.key.canonical.z < coverage.referenceZoom,
      ),
    ).toBe(true);
  });
});

function expectCoverageSamples(
  view: ViewState,
  viewport: ViewportSize,
  selected: readonly TileCoverageEntry[],
  maxGroundDistance: number,
): void {
  const referenceZoom = Math.floor(view.zoom);
  const origin = selectMapOrigin(view.center, referenceZoom);
  const camera = new PerspectiveCamera();
  updateMapCamera(camera, view, viewport, origin);

  for (let yIndex = 0; yIndex <= 8; yIndex += 1) {
    for (let xIndex = 0; xIndex <= 12; xIndex += 1) {
      const ndcX = -0.98 + (1.96 * xIndex) / 12;
      const ndcY = -0.98 + (1.96 * yIndex) / 8;
      const point = sceneGroundToMercator(
        intersectCameraRayWithGround(
          camera,
          ndcX,
          ndcY,
          maxGroundDistance,
        ),
        origin,
      );
      expect(
        selected.some((entry) => tileContainsPoint(entry.key, point)),
        `screen sample (${ndcX}, ${ndcY}) 未被 selected Tile 覆盖`,
      ).toBe(true);
    }
  }
}

function tileContainsPoint(key: RenderTileKey, point: MercatorPoint): boolean {
  const scale = 2 ** key.canonical.z;
  const tileX =
    ((point.x + Math.PI * 6_378_137) / (2 * Math.PI * 6_378_137)) *
    scale;
  const tileY =
    ((Math.PI * 6_378_137 - point.y) / (2 * Math.PI * 6_378_137)) *
    scale;
  const globalX = key.canonical.x + key.wrap * scale;
  const epsilon = 1e-8;
  return (
    tileX >= globalX - epsilon &&
    tileX <= globalX + 1 + epsilon &&
    tileY >= key.canonical.y - epsilon &&
    tileY <= key.canonical.y + 1 + epsilon
  );
}

function expectNoParentChildOverlap(
  selected: readonly TileCoverageEntry[],
): void {
  for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
    const left = selected[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
      const right = selected[rightIndex];
      if (right === undefined) {
        continue;
      }
      expect(
        isAncestorOf(left.key, right.key) || isAncestorOf(right.key, left.key),
      ).toBe(false);
    }
  }
}

function expectNeighborZoomContinuity(
  selected: readonly TileCoverageEntry[],
  maxDifference: number,
): void {
  for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
    const left = selected[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
      const right = selected[rightIndex];
      if (right === undefined || !areEdgeNeighbors(left.key, right.key)) {
        continue;
      }
      expect(
        Math.abs(left.key.canonical.z - right.key.canonical.z),
      ).toBeLessThanOrEqual(maxDifference);
    }
  }
}

function areEdgeNeighbors(left: RenderTileKey, right: RenderTileKey): boolean {
  const a = normalizedBounds(left);
  const b = normalizedBounds(right);
  const epsilon = 1e-12;
  return (
    ((Math.abs(a.maxX - b.minX) <= epsilon ||
      Math.abs(b.maxX - a.minX) <= epsilon) &&
      overlap(a.minY, a.maxY, b.minY, b.maxY) > epsilon) ||
    ((Math.abs(a.maxY - b.minY) <= epsilon ||
      Math.abs(b.maxY - a.minY) <= epsilon) &&
      overlap(a.minX, a.maxX, b.minX, b.maxX) > epsilon)
  );
}

function normalizedBounds(key: RenderTileKey): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const scale = 2 ** key.canonical.z;
  const globalX = key.canonical.x + key.wrap * scale;
  return {
    minX: globalX / scale,
    maxX: (globalX + 1) / scale,
    minY: key.canonical.y / scale,
    maxY: (key.canonical.y + 1) / scale,
  };
}

function overlap(
  firstMin: number,
  firstMax: number,
  secondMin: number,
  secondMax: number,
): number {
  return Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin);
}

function isAncestorOf(ancestor: RenderTileKey, descendant: RenderTileKey): boolean {
  const difference = descendant.canonical.z - ancestor.canonical.z;
  if (difference < 0) {
    return false;
  }
  const scale = 2 ** difference;
  const ancestorGlobalX =
    ancestor.canonical.x + ancestor.wrap * 2 ** ancestor.canonical.z;
  const descendantGlobalX =
    descendant.canonical.x + descendant.wrap * 2 ** descendant.canonical.z;
  return (
    Math.floor(descendantGlobalX / scale) === ancestorGlobalX &&
    Math.floor(descendant.canonical.y / scale) === ancestor.canonical.y
  );
}

function requireRenderKey(z: number, x: number, y: number): RenderTileKey {
  const key = createRenderTileKey(SOURCE.id, z, x, y);
  if (key === undefined) {
    throw new Error('测试 RenderTileKey 创建失败。');
  }
  return key;
}

function maxSelectedZoom(selected: readonly TileCoverageEntry[]): number {
  return Math.max(...selected.map((entry) => entry.key.canonical.z));
}
