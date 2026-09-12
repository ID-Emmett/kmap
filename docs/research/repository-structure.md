# 仓库结构与调用关系

## 入口与模块

| 路径 | 主要内容 | 上下游 |
| --- | --- | --- |
| `src/loader.js` | 动态加载 Mapbox v2/v3、AMap、free(MapLibre)、CSS、组件和灰度配置 | 页面 -> loader -> `window[globalJs]` |
| `src/mapbox/core/index.js` | KMap 工厂和 Mapbox 统一 API 导出 | loader/业务页面 -> `KMap` |
| `src/mapbox/core/KMap.js` | 兼容层/实例级地图封装 | `index.js` -> KMap |
| `src/mapbox/core/Map.js` | 继承 `window.mapboxglv3.Map`，初始化 Style、事件、控件、AMap 混合引擎和建筑模型 | KMap -> Mapbox GL JS |
| `src/mapbox/core/Vector/` | 单个 Polygon/Polyline/Circle/Rectangle，生成 GeoJSON source/layer | Overlay -> `Map.addSource/addLayer` |
| `src/mapbox/core/Vectors/` | 批量 Polygon/Polyline/Circle，批量 GeoJSON source/layer 和事件 | Overlay -> Mapbox style runtime |
| `src/mapbox/core/Marker.js` | DOM Marker、拖动、动画、Label/Popup 扩展 | 页面 -> Marker -> Mapbox Marker |
| `src/mapbox/core/MassMarkers.js` | GeoJSON circle/symbol 海量点、图片加载、轨迹动画 | 页面 -> GeoJSON source -> layer |
| `src/mapbox/core/MarkerClusterer.js` | Mapbox cluster source/layer 和聚合事件 | 页面 -> GeoJSON cluster |
| `src/mapbox/core/Layer/` | TileLayer、BaseLayer、Heatmap、DistrictLayer、RippleLayer | 页面 -> Map.addSource/addLayer |
| `src/mapbox/core/Editor/`、`Tool/` | Polygon/Polyline/Circle/Rectangle 编辑与 MouseTool 绘制 | Overlay/Map 事件 -> GeoJSON 更新 |
| `src/mapbox/business/` | 搜索、地理编码、路线、交通、围栏等业务类 | 业务类 -> `http`/AMap REST -> Overlay |
| `src/mapbox/search/` | 区域信息、分级地理信息、车辆轨迹请求 | 业务类 -> `src/mapbox/http/Http.js` |
| `src/amap/index.ts` | AMap 统一 API 导出 | loader -> `window.AMap` |
| `src/amap/Map.ts` | 继承 `window.AMap.Map`，适配 source/layer、动态 MVT、Geobuf、事件和覆盖物 | AMap -> native AMap |
| `src/amap/vector/`、`layer/`、`editor/`、`tool/` | AMap Marker/Polyline/Polygon/Circle/Heatmap/Traffic/Editor/Ranging | AMap native objects |
| `src/turf/index.js`、`src/amap/utils/Geometry.ts` | Turf 几何、距离、面积、质心、投影和 Geobuf 工具 | Overlay/MVT -> geometry helpers |
| `test/mapbox/**`、`test/loader/**`、`test/index*.html` | 人工 Demo：地图、图层、覆盖物、编辑、热力图、3D、loader | 页面 -> loader/SDK |
| `unitTest/` | Node 自执行单元测试入口 | `npm run test:unit` |

## Mapbox 初始化链

```text
页面
 -> KyemapLoader.loadMapEngine
 -> 加载 mapbox/main-v3.6.0.js + CSS + threebox（v3）
 -> 加载 ky-gis-mapbox.js
 -> KMap.createMap / new Map
 -> Utils.getKyemapStyle(styleType)
 -> mapboxgl.Map(super(opts))
 -> Style JSON 解析、sources/tiles/glyph/sprite 请求由 Mapbox GL JS 完成
 -> Map.complete(load) 回调、业务 Overlay/控件/3D 模型
```

`Map.js` 将默认 `normal` 映射到生产 `https://tiles.kye-erp.com/maptiles/styles/v3/normal.json`（`Utils.isProd=true`）。`normal-preload` 使用内置 `src/mapbox/base_config/normal-preload.js` 对象；`normal-raster` 使用 `normal_raster_prod.js`。

## AMap 初始化与动态数据链

```text
页面
 -> KyemapLoader.loadMapEngine({engine:'amap'})
 -> amap/amap-v2.0.js + ky-gis-amap.js
 -> new src/amap/Map.ts
 -> window.AMap.Map(super(...))
 -> createMVTLayer(urls, options)
 -> AMap.MapboxVectorTileLayer（渲染/事件）
 -> loadPointsForMassMarks()
 -> fetch 动态 MVT -> Pbf -> VectorTile
 -> 读取 area/boundary/center -> geoBuf Base64 -> Geobuf -> GeoJSON geometry
 -> AMap Polygon/Polyline/LabelMarker/LabelsLayer
```

AMap 适配器自己维护 `sourceMap`/`layers`，`addSource` 目前只缓存 GeoJSON 数据；它不是 Mapbox GL 的完整 style runtime。

## 数据处理职责

| 环节 | Mapbox 引擎 | JSAPI 自身 | AMap 引擎 |
| --- | --- | --- | --- |
| Style/MVT/Raster/Glyph/Sprite 请求 | Mapbox GL JS | 提供 Style URL/配置和切换 | AMap native 或适配器配置 |
| GeoJSON source/layer | Mapbox GL JS | 生成 FeatureCollection、图层 paint/layout、显隐/更新 | `src/amap/Map.ts` 转为 AMap 覆盖物 |
| 动态业务 MVT | 无统一手工解析 | `src/amap/Map.ts` 手工 fetch/Pbf/VectorTile/Geobuf | AMap MapboxVectorTileLayer + Polygon/Polyline |
| 业务 REST | 无 | `http`、axios、业务类 | AMap native plugin/REST |
| 坐标/几何 | Mapbox transform | Turf、OpenLayers proj、Geobuf 工具 | AMap LngLat/Bounds + 工具 |

## 测试与 Demo 索引

- `test/mapbox/map/map.html`、`vectorLayer.html`、`map_mbtiles.html`：基础地图、矢量图层和瓦片场景。
- `test/mapbox/overlay/*.html`：Marker、Polyline、Polygon、Circle、Cluster、MassMarkers、InfoWindow、3D。
- `test/mapbox/layers/*.html`：Heatmap、DistrictLayer。
- `test/mapbox/tool/tools.html`、`test/mapbox/geometryUtil/`：绘制工具和几何工具。
- `test/loader/test.html`、`test/index.html`、`test/index3.html`：loader/SDK 组合验证。

## 代码证据状态

上述路径和调用关系均为代码已确认；Style、瓦片、Glyph、Sprite、Raster、动态 MVT 的网络细节见对应专题文档。真实渲染性能、WebGL context 恢复、所有 REST 业务接口响应仍需人工环境验证。
