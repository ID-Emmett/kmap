# Kyemap JSAPI / KYE 数据研究

研究日期：2026-09-08

## 研究目标

本资料为后续 `nova` 3D 地图 Monorepo 提供可追溯的输入清单，覆盖现有 JSAPI 的模块/调用关系、KYE Style 与瓦片协议、Glyph/Sprite/Raster 资源、动态业务 MVT/Geobuf，以及可复用的地图能力。

附件是研究任务说明，不是生产代码修改要求。本次只分析、真实请求/解析和沉淀 Markdown，没有修改现有 JS/TS 生产实现。

## 证据状态

- **已验证**：真实 HTTP 响应、真实 PBF/PNG/PBF 解码或运行结果。
- **代码已确认**：仓库生产代码明确使用，但本次没有对该业务接口做独立运行验证。
- **待验证**：当前样本或环境不足，不能下确定结论。
- **未发现**：在本仓库和本次调查范围内没有找到对应入口；不代表服务端绝对不存在。

瓦片字段覆盖率只表示已采样瓦片中的覆盖率，不能外推为全量数据集覆盖率。

## 调查范围与目录

| 文件 | 内容 |
| --- | --- |
| [repository-structure.md](./repository-structure.md) | 目录、入口、模块职责和调用链 |
| [kye-data.md](./kye-data.md) | KYE 数据入口、请求、协议和坐标规则 |
| [kye-mvt-data-dictionary.md](./kye-mvt-data-dictionary.md) | MVT source-layer 字段字典与样本 |
| [kye-style.md](./kye-style.md) | `normal.json` sources/layers/表达式与 3D 建筑样式 |
| [kye-glyph-sprite.md](./kye-glyph-sprite.md) | Glyph、Sprite 资源和加载方式 |
| [kye-raster.md](./kye-raster.md) | KYE/高德/卫星栅格入口 |
| [dynamic-mvt.md](./dynamic-mvt.md) | 动态 MVT、GeoJSON、Geobuf 和 AMap 业务处理 |
| [existing-map-capabilities.md](./existing-map-capabilities.md) | 统一 API、高德、Mapbox 能力矩阵 |
| [reusable-assets.md](./reusable-assets.md) | `nova` 可直接复用的数据、协议、代码和待办 |
| [tile-lod-scheduling.md](./tile-lod-scheduling.md) | 高倾角 mixed LOD、Coverage 正确性与业界调度方案 |

## KYE 数据入口摘要

| 类别 | 入口 |
| --- | --- |
| Style | `https://tiles.kye-erp.com/maptiles/styles/v3/normal.json` |
| 主 MVT | `https://tiles{0..3}.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf` |
| 专用水系 | `kye_waterway`、`kye_water`、`kye_water_ocean` |
| 行政区 | `kye_admin_pro`、`kye_admin_city`、`kye_admin_county`、`kye_admin_town` |
| Raster | `.../kye_raster_tiles?tileTemplateName=normal&z={z}&x={x}&y={y}` |
| Glyph | `https://tiles.kye-erp.com/maptiles/fonts/{fontstack}/{range}.pbf` |
| Sprite | `https://tiles.kye-erp.com/maptiles/styles/v3/sprite-normal(.json/.png)` |
| 动态业务 MVT | `https://maps-vector.kye-erp.com/mapbj/vector/dynamicVectorSlicing/MAP/restriction/{z}/{x}/{y}?filter1=0,1&filter2=1` |

## 真实验证摘要

- Style 返回 HTTP 200，Style version `8`，name `normal`，id `nu83k9u`，9 个 sources、51 个 layers。
- 普通主瓦片 `z5/26/12` 返回 HTTP 200，`Content-Type: application/x-protobuf;charset=UTF-8`，`Content-Encoding: gzip`；解压后 211,879 bytes，MVT version `2`、extent `4096`。
- 高 zoom 建筑瓦片 `z15/26978/12416` 返回 HTTP 200，解压后 35,594 bytes，含 `building` 233 个 Polygon feature。
- Glyph `Microsoft YaHei Regular/0-255.pbf` 返回 HTTP 200、80,685 bytes；Sprite JSON/PNG 分别约 41,685/82,342 bytes，PNG 尺寸 `1100 x 365`，JSON 约 316 个图标。
- KYE Raster z5/26/12 返回 HTTP 200、PNG `512 x 512`、56,014 bytes；tiles0 至 tiles3 均成功。
- 动态 MVT z12、z15 均返回 MVT version `2`、extent `4096`；`geoBuf` 可 Base64 + Geobuf 解码为 FeatureCollection/MultiPolygon。

## building.height 结果

在北京有限样本（z5、z10、z12、z14、z15、z16、z17 汇总及额外高 zoom 瓦片）中，建筑 feature 的 `height` 在已采样样本中均为 number；已见范围包含 `0`、`3`、`6`、`9`、`18`、`26`、`30`、`34.5`、`43`、`47`，额外 `z15/26979/12416` 样本最高见 `66`。`buildingId` 和 `projection` 在已采样建筑中存在，MVT feature 顶层 `id` 未发现。`min_height` 在已采样建筑中未发现。MVT feature 类型为 Polygon；一个样本 feature 含多个 ring，说明存在洞的编码可能，但没有在样本中发现独立 MultiPolygon 类型。

这些数字是有限样本观测，不是全量覆盖率或全局最大/最小值。

## 可复用资产

- Style JSON、51 个图层的 source/source-layer/filter/layout/paint 结构。
- 主 MVT 的 gzip + MVT v2/extent 4096 解析链和 source-layer 字典。
- 专用水系/行政区 MVT 及行政区四种子图层（area/border/center/gov）。
- Microsoft YaHei Glyph 和 316 项 Sprite 图标元数据。
- KYE Raster、高德道路 Raster、卫星 + 道路双 Raster 配置。
- AMap `geoBuf` 的 Base64/Pbf/Geobuf 解码、EPSG:3857 -> EPSG:4326 转换和 MVT overlay 交互逻辑。
- Mapbox GeoJSON source、fill/line/circle/symbol/heatmap/fill-extrusion 图层构建方式，以及 Overlay/编辑/事件 API。

## 待验证事项

- KYE tiles 节点的正式负载均衡/故障切换规则、缓存头和长期稳定性。
- 全量 zoom/地域下 `building.height`、`min_height`、洞和房屋部件覆盖率。
- `road`、`poi_label`、行政区所有字段的全量 schema 与版本兼容性。
- 高德搜索、IP 定位、路径规划、Terrain、GeoHUB 和 `appmaptile` 在当前环境中的真实响应与配额。
- Mapbox GL/AMap 具体版本、WebGL 性能和 3D 模型资源（`KYE_A.gltf`/`KYE_B.gltf`）的许可与线上可用性。

## 关键代码入口

- Mapbox 统一入口：`src/mapbox/core/index.js`、`src/mapbox/core/Map.js`、`src/mapbox/core/KMap.js`。
- AMap 统一入口：`src/amap/index.ts`、`src/amap/Map.ts`。
- Loader：`src/loader.js`、`src/loader-callback.js`、`src/loader2.js`。
- Style 选择：`src/mapbox/utils/utils.js`；KYE/高德/卫星配置位于 `src/mapbox/base_config/`。
- Overlay/GeoJSON：`src/mapbox/core/Vector/`、`src/mapbox/core/Vectors/`、`src/mapbox/core/MassMarkers.js`。
- 动态 MVT/Geobuf：`src/amap/Map.ts`、`src/amap/utils/Geometry.ts`。

补充：按仓库规则检查了 `src/**/docs/index.md`，未发现该索引；`docs/index.md` 与 `docs/cross-engine-sync/**` 的既有用户改动均未触碰。
