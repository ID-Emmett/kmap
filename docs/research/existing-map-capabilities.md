# 现有地图能力矩阵

状态说明：Mapbox/AMap 列表示底层或适配器是否有对应实现；“当前实现”描述统一 API 的实际行为，代码证据为生产源码入口。

| 能力 | 统一 API | 高德 | Mapbox | 当前实现 | 关键文件 | 数据来源 |
| --- | --- | --- | --- | --- | --- | --- |
| 地图初始化 | 有 | `AMap.Map` | `mapboxgl.Map` | 两套入口由 loader 按 engine 加载 | `src/amap/Map.ts`、`src/mapbox/core/Map.js`、`src/loader.js` | Style/AMap config |
| center / zoom | 有 | 原生 | 原生 | `getCenter/setCenter/getZoom/setZoom` 及 bounds | `Map.js`、`Map.ts` | 地图 transform |
| pan / fit bounds | 有 | 原生 `setFitView` 适配 | `cameraForBounds/flyTo` | `panByBounds/setFitView/setBounds` | 两个 Map 文件 | 坐标/Bounds |
| rotate / pitch | 有 | rotation/pitch options | bearing/pitch options | Mapbox 继承 + AMap options | `Map.js`、`Map.ts` | 引擎视图 |
| Marker | 有 | AMap Marker/LabelMarker | Mapbox DOM Marker | 位置、图标、拖动、动画、Popup/Label 扩展 | `src/mapbox/core/Marker.js`、`src/amap/Marker.ts` | 用户图片/DOM |
| 海量点 | 有 | LabelsLayer/LabelMarker | GeoJSON circle/symbol | MassMarkers，两套实现 | `MassMarkers.js`、`src/amap/MassMarkers.ts` | GeoJSON |
| Cluster | 有 | `AMap.MarkerCluster` | GeoJSON cluster（Mapbox） | Mapbox Clusterer；AMap 封装 MarkerClusterer | 对应 Clusterer 文件 | GeoJSON/AMap |
| Polyline | 有 | `AMap.Polyline` | GeoJSON line layer | path -> FeatureCollection -> line/outline/arrow layers | `src/mapbox/core/Vectors/Polyline.js`、`src/amap/vector/Polyline.ts` | GeoJSON |
| Polygon | 有 | `AMap.Polygon` | GeoJSON fill + line | 支持 Polygon/MultiPolygon、显隐、面积、编辑 | `Polygon.js`、`src/amap/vector/Polygon.ts` | GeoJSON/Turf |
| Circle | 有 | AMap Circle/CircleMarker | Turf circle -> Polygon | `Circle`/`Circles` 生成 polygon | `Vector/Circle.js`、`src/amap/vector/Circle.ts` | Turf |
| Fence | 有业务类 | 以 REST/AMap overlay 为主 | Overlay + DOM panel | GeoFencePoint/GeoFenceDepart 通过 `http` 查询并绘制 | `src/mapbox/business/GeoFence*.js` | KYE REST |
| Layer | 有 | native layer + `LayerManger` | TileLayer/BaseLayer/District/Heatmap/Ripple | addSource/addLayer、样式切换、显隐 | `src/mapbox/core/Layer/`、`src/amap/LayerManger.ts` | Style/GeoJSON/Raster |
| Popup | 有 | InfoWindow | Popup | InfoWindow/ContextMenu 与 AMap InfoWindow | `InfoWindow.js`、`src/amap/InfoWindow.ts` | DOM/HTML |
| Event | 有 | native event | Mapbox event | Map/Overlay 事件映射；AMap `filterEventName` | `Event.js`、`EventsManage.js`、`src/amap/Map.ts` | 引擎事件 |
| Picking | 有 | MVT e.features + 自定义聚合 | `queryRenderedFeatures` | Mapbox 使用原生；AMap `queryRenderedFeatures()` 聚合当前对象 | `Map.js`、`src/amap/Map.ts` | 渲染 feature/事件 |
| 编辑 | 有 | AMap PolylineEditor 等 | 自定义 Editor + Mapbox source update | Poly/Polys/Circle/Rectangle 编辑，undo/redo | `src/mapbox/core/Editor/`、`src/amap/editor/` | GeoJSON path |
| 测距 | 有 | `AMap.RangingTool` | Turf/GeometryUtil 可计算 | AMap RangingTool；Mapbox GeometryUtil/Turf 函数可算距离 | `src/amap/tool/RangingTool.ts`、`src/mapbox/utils/GeometryUtil.js` | Turf/AMap |
| 测面积 | 有 | Polygon + GeometryUtil | Turf `area` | Mapbox Vector.getArea；AMap Geometry/Turf 工具，无独立 AMap 面积 Tool | `src/mapbox/core/Vector/Vector.js`、`src/amap/utils/Geometry.ts` | Turf |
| MVT | 有 | MapboxVectorTileLayer + 手工解析 | Mapbox GL 原生 Style source | KYE 主 MVT 由 Mapbox GL；动态业务 MVT 由 AMap 适配器手工处理 | `Map.js`、`src/amap/Map.ts` | KYE/业务 MVT |
| GeoJSON | 有 | 适配为 AMap objects | GeoJSON source/layer | addSource/setData、Overlay FeatureCollection | `Vector.js`、`Map.ts` | 用户输入 |
| Geobuf | 有业务工具 | 适配器解码 | 未发现 Mapbox 主链手工解码 | Base64 -> Pbf -> geobuf -> geometry | `src/amap/utils/Geometry.ts` | 动态 geoBuf |

## Mapbox 覆盖物处理

`Vector` 基类统一把 path/center/radius 转成 Turf FeatureCollection；Polygon 创建 fill source/layer 和 line outline source/layer，Polyline 创建 line/outline/arrow symbol layer，属性通过 `['get', ...]` 表达式读取。`setPath` 调用 GeoJSON source 的 `setData`，`remove/hide/show` 维护 layer/source。

## AMap 适配边界

- `src/amap/Map.ts:addSource` 只缓存 GeoJSON 数据，`addLayer` 再把 source features 转成 AMap 对象；它不执行完整 Mapbox Style 表达式。
- `createMVTLayer` 使用 AMap MapboxVectorTileLayer，但为支持业务 `geoBuf` 又直接 fetch/解码 MVT，存在两条并行数据路径。
- AMap 的原生搜索/交通/编辑能力通过 `window.AMap.plugin` 或原生对象提供，统一 API 只做轻量封装。

## 业务 REST 与高德边界

| 能力 | 代码入口/接口 | 证据状态 |
| --- | --- | --- |
| POI 文本/周边/多边形搜索 | `src/mapbox/business/LocalSearch.js` -> `//restapi.amap.com/v3/place/text|around|polygon`，固定 key，回调 `result.data.pois` | 代码已确认；未做本次真实请求 |
| IP 定位 | `LocalCity.js` -> `//restapi.amap.com/v3/ip` | 代码已确认；未做真实请求 |
| 自动完成/地址解析 | `Autocomplete.js` -> `map.bsm.position.bsmFindPosition`，空结果再 `ams.distribute.getGeoCoder` | 代码已确认 |
| 逆地理编码 | `Geocoder.js` -> `kyemap.mapservice.reverseGeocoding` | 代码已确认 |
| 驾车路线 | `RoutePlan.js` -> `kyemap.mapservice.cardirection`，压缩 polyline 解码后绘制 | 代码已确认 |
| 货车路线 | `TruckPlan.js` -> `kyemap.mapservice.truckdirection` | 代码已确认 |
| 车牌路线 | `Platedirection.js` -> `kyemap.mapservice.plate.direction` | 代码已确认 |
| 交通栅格 | `business/TrafficLayer.js` -> `https://maps.kye-erp.com/trafficengine/mapabc/traffictile?...` | URL/调用代码已确认；未真实取图 |
| 默认底图 | KYE Style/MVT 或高德 appmaptile style 6/7/8 | KYE Raster/MVT 已验证；高德逐 URL 待验证 |
| 道路/建筑/POI 原始数据 | KYE 主 MVT `road/building/poi_label`；高德 appmaptile 只有图片 | KYE MVT 已验证；高德原始矢量未发现 |
| Terrain | `Map.js` 有 globe/fog/cloud/threebox 相关配置，未发现独立 KYE Terrain URL | 未发现独立 Terrain 数据入口 |
| GeoHUB MVT | 本仓库搜索未发现明确 GeoHUB URL/类 | 未发现 |

高德 `appmaptile` 是 Raster 图片，不可从中直接获取建筑高度、道路字段或 POI 属性；需要 KYE MVT/业务 REST 或高德独立矢量/搜索接口。
