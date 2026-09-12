# 可复用资产与 nova 输入清单

## 数据复用矩阵

| 数据/能力 | 已存在 | 格式 | nova 输入可用 | 需要转换 | 关键代码/URL | 证据状态 |
| --- | --- | --- | --- | --- | --- | --- |
| KYE Style | 是 | Mapbox Style JSON v8 | 可直接作为 MapLibre/Mapbox 风格输入，需确认 3D 引擎兼容 | 可能改 source URL、表达式兼容性 | `kye-style.md`；normal.json | 已验证 |
| KYE 主 MVT | 是 | gzip MVT/PBF v2，extent 4096 | 可直接作为 vector tile source | 需要实现 gzip/MVT parser 或交给渲染引擎 | `kye-data.md` | 已验证 |
| 专用水系 | 是 | MVT/PBF | 可直接 source | 按 source-layer/style 绑定 | `kye_waterway/water/ocean` | 已验证 |
| 行政区 | 是 | MVT/PBF，area/border/center/gov | 可直接作为行政区图层 | 统一字段类型，按 level/tileType 映射 | `kye_admin_*` | 已验证 |
| `building.height` | 是（样本） | number 属性 | 可用于 3D extrusion | 处理缺失/0、过滤 building:part | 主 MVT building | 已验证（有限样本） |
| `building.min_height` | 样本未发现 | - | 不可假设可用 | 需全量验证后决定 | 主 MVT building | 未发现/待验证 |
| Glyph | 是 | PBF glyph | MapLibre/Mapbox 可直接使用 | 字体 fallback/许可核对 | glyph URL | 已验证 |
| Sprite | 是 | sprite JSON + PNG | 可直接用于 Mapbox 风格；3D 引擎需纹理适配 | UV/像素比读取 metadata | sprite-normal | 已验证 |
| KYE Raster | 是 | PNG raster tile | 可作为影像/兼容底图 | 处理 512 PNG 与 tileSize 256 | normal_raster_prod.js | 已验证 |
| 高德 Raster | 是 | appmaptile PNG | 可作为外部底图（合规前提） | URL/跨域/配额/坐标核对 | gaode/weixing configs | 代码已确认/待验证 |
| Business MVT | 是 | 未压缩 MVT，属性含 Base64 Geobuf | 可用于限制区域/业务面线点 | 解码 geoBuf、3857->4326、业务字段清洗 | `src/amap/Map.ts` | 已验证 |
| GeoJSON | 是 | Feature/FeatureCollection | 直接作为业务 overlay/source | 统一坐标精度和 Polygon 闭合 | `src/mapbox/core/Vector*` | 代码已确认 |
| Geobuf | 是 | Base64 Geobuf PBF | 可作为压缩业务几何输入 | Base64/Pbf/geobuf 解码，类型兼容 | `src/amap/utils/Geometry.ts` | 已验证 |
| Mapbox runtime | 是 | Mapbox GL JS API | 可复用 source/layer/filter/layout/paint 语义 | 3D 引擎需重写 renderer/picking | `src/mapbox/core/Map.js` | 代码已确认 |
| AMap runtime | 是 | AMap v2/native overlays | 仅在需要高德插件时复用 | nova 需隔离厂商 API | `src/amap/` | 代码已确认 |
| 外部 Raster（腾讯/百度） | 是（配置） | PNG/外部 tile | 仅在授权和凭证确认后使用 | 处理 key、跨域、坐标和配额 | `tencent_base.js`、`baidu_base.js` | 代码已确认/待验证 |
| 3D GLTF 示例模型 | 是（线上 URL） | GLTF/GLB via Threebox | 仅作示例资产，不能假设为通用建筑数据 | 许可、版本、坐标和 Threebox 适配 | `Map.js` -> `KYE_A.gltf`/`KYE_B.gltf` | 代码已确认/待验证 |

## nova 直接输入清单

```text
数据源
- normal Style: https://tiles.kye-erp.com/maptiles/styles/v3/normal.json
- 主 MVT: https://tiles{0..3}.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf
- kye_waterway / kye_water / kye_water_ocean
- kye_admin_pro / city / county / town
- Raster: .../kye_raster_tiles?tileTemplateName=normal&z={z}&x={x}&y={y}
- Business MVT: ...dynamicVectorSlicing/MAP/restriction/{z}/{x}/{y}?filter1=0,1&filter2=1

格式
- Style v8 JSON
- gzip MVT v2, extent 4096
- PNG raster（实测 512x512）
- Glyph PBF、Sprite JSON/PNG
- Business geoBuf = Base64(Geobuf PBF)

图层/字段
- building: height:number、buildingId:number、kind/name/projection；min_height 未在样本发现
- road: class/subclass/level/name/name_en/id/brunnel/oneway/layer；部分 ref/letter/ref_length
- poi_label: class/subclass/rank/name/short_name/cityCode/osmId/level
- place: class/name/rank/iso_a2/capital
- water/waterway/landuse/boundary/aoi
- 行政区：area/border/center/gov + admin_code/district_name/admin_name/district_id/tileType/level/full_name/center_x/center_y

资源
- Glyph fontstack Microsoft YaHei Regular
- Sprite sprite-normal.json/png，约316 icons，1100x365
- 本地箭头、start/end、Marker/ MassMarkers 图片注册逻辑

坐标规则
- XYZ Web Mercator tile，MVT extent 4096
- Geobuf 可能是 EPSG:3857，按坐标量级判断后转 EPSG:4326
- 用户 Overlay 通常使用经纬度 [lng,lat]

zoom
- 主 Style source openmaptiles 0-17，building3D 15.6-24
- 水系 0-7，高 zoom ocean 7-24
- 行政区 0-14，Raster 0-18（配置）
```

## 可参考实现

- `src/mapbox/core/Map.js`：Style 选择、Mapbox 生命周期、source/layer 快照、样式切换、globe/fog/threebox。
- `src/mapbox/core/Vector/Vector.js` 与 `Vectors/*`：将路径转 GeoJSON、source/layer 创建、显隐、更新、面积和事件。
- `src/amap/Map.ts`：动态 MVT 的可见瓦片计算、MVT 读取、业务图层显隐、点击/悬停和简单空间索引。
- `src/amap/utils/Geometry.ts`：Geobuf 解码、EPSG 转换、质心/Bounds/距离辅助。
- `src/mapbox/utils/utils.js`：Style 路由、坐标归一化、GeoJSON extent、投影转换和图片注册。
- `src/mapbox/business/TrafficLayer.js`：Raster traffic source/layer 的生命周期。

## 风险与后续验证

1. 对所有外部 URL 保留超时、重试、204 空瓦片和节点降级策略；Style 中列出的四节点不等于正式负载均衡规则。
2. 建筑高度先按缺失/0 做降级，不能依赖 `min_height` 或假设所有建筑都有有效高度。
3. 3D renderer 需要处理 Polygon ring/hole、瓦片边界裁剪、坐标投影和建筑部件过滤。
4. Sprite/Glyph 的许可、缓存和字体 fallback 需要产品环境确认。
5. 高德 REST、Traffic、GeoHUB、Terrain 和 appmaptile 的配额/许可/真实响应尚未完成独立验证。

## 研究边界

本目录没有修改 `src/`、`build/`、`public/` 或测试生产实现；所有“代码已确认”均表示静态调用链证据，所有“已验证”均对应本次真实网络/解析样本。
