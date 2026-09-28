import type { RasterTileSourceOptions, VectorTileSourceOptions } from '@kmap/map3d';

/** KYE 主瓦片定义其区域的海陆边界；海洋补充仅服务无主源内容的区域。 */
export const PLAYGROUND_SOURCE: VectorTileSourceOptions = {
  id: 'kye-main',
  tiles: [0, 1, 2, 3].map(i => `https://tiles${i}.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf`),
  minZoom: 0, maxZoom: 17,
  overlays: [
    { tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf'], minZoom: 6, maxZoom: 6, sourceLayer: 'place', targetLayer: 'place' },
    ...(['boundary', 'waterway'] as const).map(sourceLayer => ({ tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf'], minZoom: 7, maxZoom: 6, sourceLayer, targetLayer: sourceLayer, onlyWhenLayerMissing: true })),
    { tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/kye_water/{z}/{x}/{y}.pbf'], minZoom: 0, maxZoom: 6, sourceLayer: 'water', targetLayer: 'ocean_base', onlyWhenPrimaryEmpty: true },
    { tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/kye_water_ocean/{z}/{x}/{y}.pbf'], minZoom: 7, maxZoom: 7, sourceLayer: 'water', targetLayer: 'ocean', onlyWhenPrimaryEmpty: true },
    { tiles: ['https://tiles0.kye-erp.com/v2/maptile-dispatch/data/kye_admin_pro/{z}/{x}/{y}.pbf'], minZoom: 2, maxZoom: 14, sourceLayer: 'border', targetLayer: 'province_border' },
  ],
};

/** 高德 style=6 原生影像；z0 与北京 z19 的占位图片由哈希登记为无内容。 */
export const PLAYGROUND_SATELLITE_SOURCE: RasterTileSourceOptions = {
  id: 'amap-satellite',
  tiles: [1, 2, 3, 4].map(i => `https://webst0${i}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}`),
  tileSize: 256,
  minZoom: 1,
  maxZoom: 18,
  missingTileHashes: ['24b9a6081f06fe76f8461e18f27375f90a1349932fbe635256fd72d523a16854'],
  attribution: '高德地图',
};
