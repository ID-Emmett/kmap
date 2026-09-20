import type { VectorTileSourceOptions } from '@kmap/map3d';

/** KYE 来源层级与合成职责；基础海洋和稀疏详细海洋各自独立加载。 */
export const PLAYGROUND_SOURCE: VectorTileSourceOptions = {
  id: 'kye-main',
  tiles: [0, 1, 2, 3].map(i => `https://tiles${i}.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf`),
  minZoom: 0, maxZoom: 17,
  overlays: [
    { tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf'], minZoom: 6, maxZoom: 6, sourceLayer: 'place', targetLayer: 'place' },
    ...(['boundary', 'waterway'] as const).map(sourceLayer => ({ tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf'], minZoom: 7, maxZoom: 6, sourceLayer, targetLayer: sourceLayer, onlyWhenLayerMissing: true })),
    { tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/kye_water/{z}/{x}/{y}.pbf'], minZoom: 0, maxZoom: 6, sourceLayer: 'water', targetLayer: 'ocean_base' },
    { tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/kye_water_ocean/{z}/{x}/{y}.pbf'], minZoom: 7, maxZoom: 7, sourceLayer: 'water', targetLayer: 'ocean' },
    { tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/kye_admin_pro/{z}/{x}/{y}.pbf'], minZoom: 2, maxZoom: 14, sourceLayer: 'border', targetLayer: 'province_border' },
  ],
};
