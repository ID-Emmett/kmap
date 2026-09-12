# KYE 数据入口与协议

## 入口总表

| 数据 | URL/模板 | 格式 | zoom/图层 | 状态 |
| --- | --- | --- | --- | --- |
| Style | `https://tiles.kye-erp.com/maptiles/styles/v3/normal.json` | JSON Style v8 | 51 layers | 已验证 HTTP 200 |
| 主地图 | `https://tiles{0..3}.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf` | gzip 压缩 MVT/PBF | source-layer 随 zoom 变化，source max 17 | 已验证 |
| 低 zoom 水道 | `.../data/kye_waterway/{z}/{x}/{y}.pbf` | MVT/PBF | `waterway`，Style max 6 | 已验证 |
| 低 zoom 水面 | `.../data/kye_water/{z}/{x}/{y}.pbf` | MVT/PBF | `water`，Style max 6 | 已验证 |
| 高 zoom 海洋 | `.../data/kye_water_ocean/{z}/{x}/{y}.pbf` | MVT/PBF | `water`，Style min 7/max 7 | 已验证 |
| 行政区 | `.../data/kye_admin_{pro,city,county,town}/{z}/{x}/{y}.pbf` | MVT/PBF | `area/border/center/gov`，max 14 | 已验证 |
| KYE Raster | `https://tiles{0..3}.kye-erp.com/maptile-dispatch/data/kye_raster_tiles?tileTemplateName=normal&z={z}&x={x}&y={y}` | PNG | 0-18（配置） | 已验证 |
| 动态业务 | `https://maps-vector.kye-erp.com/mapbj/vector/dynamicVectorSlicing/MAP/restriction/{z}/{x}/{y}?filter1=0,1&filter2=1` | 未压缩 MVT，属性内含 Geobuf | `area/center`，部分瓦片有 boundary | 已验证 |
| Glyph | `https://tiles.kye-erp.com/maptiles/fonts/{fontstack}/{range}.pbf` | Glyph PBF | Style 使用 Microsoft YaHei Regular | 已验证 |
| Sprite | `https://tiles.kye-erp.com/maptiles/styles/v3/sprite-normal.json` + `.png` | JSON + PNG | 约 316 icons | 已验证 |

## 节点与请求行为

- Style 中所有 KYE vector source 都列出 `tiles0`、`tiles1`、`tiles2`、`tiles3` 四个 URL；主瓦片普通样本使用 `tiles0` 成功，四节点 Raster 样本均成功。
- 本次直接请求未携带 API key、Authorization 或自定义鉴权头；响应成功不能证明生产环境永远不需要网关策略或 Referer/CORS 条件。
- 普通主瓦片响应：`Content-Type: application/x-protobuf;charset=UTF-8`，`Content-Encoding: gzip`。Node 端先 gunzip，再用 `vector-tile` + `pbf` 解析。
- 专用水系/行政区瓦片也按 MVT 解析；部分无数据瓦片返回 HTTP 204、空 body，这是“无数据”而非解析失败。
- 动态业务 MVT 样本无 `Content-Encoding`，直接 `ArrayBuffer -> Uint8Array -> Pbf -> VectorTile`。

## MVT 基本规则

- 实测 Vector Tile version `2`，extent `4096`。
- 瓦片坐标为标准 Web Mercator XYZ：`x=floor((lng+180)/360*2^z)`，`y=floor((1-log(tan(lat)+sec(lat))/pi)/2*2^z)`。
- MVT geometry 通过 `feature.type` 区分 Point(1)、LineString(2)、Polygon(3)。普通主瓦片的 `building` feature 顶层 `id` 在样本中未发现；业务属性通常位于 `feature.properties`。
- AMap 动态 MVT 手工坐标转换使用 extent 4096、tileSize 256，再转经纬度；Geobuf 若坐标绝对值大于 100000，则按 EPSG:3857 转 EPSG:4326。

## 典型请求样本

| 样本 | 压缩后/解压后 | 图层摘要 |
| --- | --- | --- |
| 主 MVT `z5/26/12` | 98,298 / 211,879 bytes | landcover_0 4、hillshade 303、water 12、waterway 4、landuse 119、boundary 655、transportation 5,395、place 325 |
| 主 MVT `z15/26978/12416` | 响应 gzip，解压 35,594 bytes | water 4、landuse 39、poi_label 17、building 233、road 386、waterway 1 |
| 动态 MVT z12/z15 | 未压缩 | area Polygon、center Point，部分瓦片含 boundary |
| Raster `z5/26/12` | PNG 56,014 bytes，512x512 | KYE normal raster |

## 请求链

```text
Mapbox Map
 -> Style URL
 -> Mapbox GL JS 读取 sources
 -> 选择 tiles0..3
 -> HTTP gzip PBF
 -> Mapbox GL JS gunzip + MVT decode
 -> filter/layout/paint
 -> WebGL 渲染
```

```text
AMap Map.createMVTLayer
 -> AMap.MapboxVectorTileLayer(url template)
 -> src/amap/Map.ts loadPointsForMassMarks
 -> fetch ArrayBuffer
 -> Pbf + VectorTile
 -> area/boundary/center feature
 -> geoBuf Base64 + Geobuf
 -> Polygon/Polyline/LabelMarker/LabelsLayer
```

## 待验证

- 节点选择是否由 Mapbox GL 的轮询、随机或错误重试实现，仓库 Style 只声明了四个模板。
- CDN 缓存、ETag、Cache-Control、CORS、跨域凭证和长期版本策略。
- MVT 完整 schema、瓦片裁剪边界、feature 顶层 id 的全量行为。
