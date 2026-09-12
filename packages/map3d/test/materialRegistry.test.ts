import { Color } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { createLineLayerRecipe, createPolygonLayerRecipe } from '../src/geometry/types.js';
import { MaterialRegistry } from '../src/rendering/materialRegistry.js';

describe('MaterialRegistry', () => {
  it('为 Polygon/Line 共享远景渐隐 uniform 且不破坏过渡 opacity', () => {
    const registry = new MaterialRegistry();
    const fadeColor = new Color('#f5f5f2');
    registry.setHorizonFade(
      { start: 100, end: 400, strength: 0.5 },
      fadeColor,
    );
    const polygonRecipe = createPolygonLayerRecipe({
      type: 'fill',
      id: 'landuse',
      sourceLayer: 'landuse',
      paint: { color: '#ecedeb', opacity: 0.8 },
    });
    const lineRecipe = createLineLayerRecipe({
      type: 'line',
      id: 'road',
      sourceLayer: 'road',
      paint: { color: '#ffffff', opacity: 0.7, width: 3 },
    });

    const polygon = registry.acquire(polygonRecipe.material);
    const line = registry.acquireLine(lineRecipe.material);

    expect(polygon.colorNode).toBeDefined();
    expect(line.colorNode).toBeDefined();
    expect(line.vertexNode).toBeDefined();
    expect(polygon.opacity).toBe(0.8);
    expect(line.opacity).toBe(0.7);
    expect(registry.getHorizonFade()).toMatchObject({
      start: 100,
      end: 400,
      strength: 0.5,
      color: { r: fadeColor.r, g: fadeColor.g, b: fadeColor.b },
    });
    expect(registry.getStats()).toEqual({ materials: 2, references: 2 });

    registry.release(polygonRecipe.material.key);
    registry.release(lineRecipe.material.key);
    expect(registry.getStats()).toEqual({ materials: 0, references: 0 });
    registry.dispose();
    expect(registry.getHorizonFade()).toMatchObject({
      start: 1,
      end: 2,
      strength: 0,
    });
  });
});
