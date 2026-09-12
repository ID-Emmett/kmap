# 动态 MVT、GeoJSON 与 Geobuf

## 业务入口

`src/amap/Map.ts` 中的 `createMVTLayer(urls, options)` 和 `loadPointsForMassMarks()` 使用：

```text
https://maps-vector.kye-erp.com/mapbj/vector/dynamicVectorSlicing/MAP/restriction/{z}/{x}/{y}?filter1=0,1&filter2=1
```

真实 z12、z15 请求均 HTTP 200，`Content-Type: application/x-protobuf;charset=UTF-8`，无 `Content-Encoding`；MVT version `2`、extent `4096`。

## AMap 原生 MVT layer

`createMVTLayer` 将 `{x}/{y}/{z}` 改成 AMap 模板的 `[x]/[y]/[z]`，构造 `window.AMap.MapboxVectorTileLayer`：

- id 默认 `custormRestriction`；zIndex 999；tileSize 256。
- `zooms/dataZooms` 默认 3-18，可由 options 覆盖。
- 顶层 `bubble:true`，以便点击事件触发。
- polygon sourceLayer=`area`，可见、`geoBuffer:true`。
- line sourceLayer=`boundary`，默认隐藏、`geoBuffer:true`。
- point sourceLayer=`center`，默认隐藏、`geoBuffer:true`。
- 绑定 `mousemove`/`click`，点击时从 `e.features.polygon` 或 `polygons` 取要素属性。

## 手工解析链

```text
getVisibleTiles(map)
 -> 当前 Bounds + floor(getZoom()) - 1
 -> Web Mercator lngLatToTile
 -> 外扩 2 圈 x/y
 -> fetch(url)
 -> response.arrayBuffer()
 -> new Pbf(new Uint8Array(arrayBuffer))
 -> new VectorTile(pbf)
 -> tileData.layers.center/boundary/area
 -> feature.loadGeometry() 或 feature.properties.geoBuf
```

`center` 点图层使用 MVT extent 4096 转经纬度，生成 AMap `LabelMarker` 并加入 `LabelsLayer`；`boundary` 线图层和 `area` 面图层优先读取属性里的 `geoBuf`。

## geoBuf / Geobuf

`src/amap/utils/Geometry.ts:getGeobufData`：

1. `window.atob(base64)` -> `ArrayBuffer`；
2. `new Pbf(arrayBuffer)`；
3. `geobuf.decode(pbf)` -> FeatureCollection；
4. 取 `feature.features[0].geometry`；
5. 若坐标绝对值大于 100000，使用 `geojson-projector` 将 EPSG:3857 转 EPSG:4326；GeometryCollection 取 Polygon（不存在时取第一个 geometry）。

真实解码样本返回 FeatureCollection，示例 Geometry 为 MultiPolygon，坐标约 `[116.27097, 39.78452]`，证明 `geoBuf` 不是普通 JSON 字符串，而是 Base64 包装的 Geobuf PBF。

动态 MVT 主要字段（不同 feature 可能缺省）：

```text
id, ring, type, adcode, adname, cityId, geoBuf, ruleid, status, pathIdx,
summary, vehicle, cityCode, cityName, createdBy, otherDesc, updatedBy,
policyName, provinceId, centerPoint, description, enabledFlag, restricType,
vehicleSize, creationDate, provinceCode, provinceName, updationDate,
effectiveTime, rowAuthCustom, effectiveTimeDetail
```

## 业务渲染与交互

- `area` 解码后合并 `polygonPaths`，创建 AMap Polygon 和质心 LabelMarker。
- `boundary` 解码后收集 `lineFeatures`，生成 Polyline；建立当前数组型空间索引，点击使用包围盒 + 点到线段 Haversine 距离寻找最近 feature。
- `center` 生成 LabelMarker，图标由 `pointOptions.icon.imageUrl` 提供。
- `moveend` 防抖 300ms 重取当前可见瓦片，按 `custormMinZoom/custormMaxZoom` 显隐线/面，并刷新 LabelsLayer。
- `queryRenderedFeatures()` 是 AMap 适配器的聚合方法，返回 MVT、LabelMarker、Polyline、MassMarkers 的当前点击/悬停信息，不是 Mapbox 原生返回结构。

## GeoJSON 能力

- Mapbox `Vector`/`Vectors`/`Heatmap`/`MassMarkers` 将用户 path/datas 转成 GeoJSON FeatureCollection，调用 `map.addSource({type:'geojson'})` 和 `source.setData()`。
- `src/amap/Map.ts:addSource` 只对 GeoJSON source 做 `sourceMap` 缓存；AMap 侧通过 Polygon/Polyline/LabelsLayer 对象绘制。
- `src/types/GeoJSON.ts` 定义 Point/LineString/Polygon/MultiPolygon/Feature/FeatureCollection 类型。

## 待验证

- 动态接口的完整 zoom/地域覆盖率、filter1/filter2 语义、鉴权和版本策略。
- Geobuf 的所有 geometry 类型、GeometryCollection 选择规则是否满足全部业务。
- `getVisibleTiles` 外扩 2 圈和 `zoom-1` 的性能、跨日期线/极区边界行为。
