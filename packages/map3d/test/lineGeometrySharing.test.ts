import { describe, expect, it } from 'vitest';

import { createLineGeometryKey } from '../src/geometry/lineGeometrySharing.js';
import { createLineLayerRecipe } from '../src/geometry/types.js';

const KEY = { sourceId: 'main', z: 10, x: 843, y: 388 } as const;

describe('createLineGeometryKey', () => {
  it('忽略 paint、layer id 和 renderOrder，只比较 topology 输入', () => {
    const casing = createLineLayerRecipe(
      {
        type: 'line',
        id: 'road-casing',
        sourceLayer: 'road',
        minZoom: 9,
        filters: [{ operator: 'has', property: 'name' }],
        paint: { color: '#d4d7da', opacity: 0.8, width: 6 },
      },
      5,
    );
    const fill = createLineLayerRecipe(
      {
        type: 'line',
        id: 'road-fill',
        sourceLayer: 'road',
        minZoom: 9,
        filters: [{ operator: 'has', property: 'name' }],
        paint: { color: '#ffffff', opacity: 1, width: 2 },
      },
      6,
    );

    expect(createLineGeometryKey(KEY, casing)).toBe(
      createLineGeometryKey(KEY, fill),
    );
  });

  it('不同 sourceLayer、filter 或 zoom 可见性不会共享', () => {
    const base = createLineLayerRecipe({
      type: 'line',
      id: 'base',
      sourceLayer: 'road',
      minZoom: 9,
      filters: [{ operator: 'has', property: 'name' }],
      paint: { color: '#fff', width: 2 },
    });
    const differentSource = createLineLayerRecipe({
      type: 'line',
      id: 'source',
      sourceLayer: 'transportation',
      minZoom: 9,
      filters: [{ operator: 'has', property: 'name' }],
      paint: { color: '#fff', width: 2 },
    });
    const differentFilter = createLineLayerRecipe({
      type: 'line',
      id: 'filter',
      sourceLayer: 'road',
      minZoom: 9,
      filters: [{ operator: '==', property: 'name', value: 'main' }],
      paint: { color: '#fff', width: 2 },
    });
    const differentZoom = createLineLayerRecipe({
      type: 'line',
      id: 'zoom',
      sourceLayer: 'road',
      minZoom: 8,
      filters: [{ operator: 'has', property: 'name' }],
      paint: { color: '#fff', width: 2 },
    });
    const baseKey = createLineGeometryKey(KEY, base);

    expect(createLineGeometryKey(KEY, differentSource)).not.toBe(baseKey);
    expect(createLineGeometryKey(KEY, differentFilter)).not.toBe(baseKey);
    expect(createLineGeometryKey(KEY, differentZoom)).not.toBe(baseKey);
  });
});
