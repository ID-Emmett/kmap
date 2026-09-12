# Glyph 与 Sprite

## Glyph

| 项目 | 结果 |
| --- | --- |
| URL 模板 | `https://tiles.kye-erp.com/maptiles/fonts/{fontstack}/{range}.pbf` |
| 实际 fontstack | `Microsoft YaHei Regular` |
| 实际请求 | `.../Microsoft%20YaHei%20Regular/0-255.pbf`、`256-511.pbf` |
| 响应 | HTTP 200；80,685 bytes / 70,034 bytes |
| 格式 | PBF glyph；本次确认可下载，未在 SDK 中发现自有 glyph parser |
| 加载者 | Mapbox GL JS 根据 Style 的 `glyphs` 模板请求和缓存 |
| 使用图层 | road-label、road shield、POI、place、行政区 symbol 等文字图层 |

代码证据：`normal-preload.js`、`normal_raster_prod.js`、`gaode_base.js`、`gaode_simp.js` 等 Style 配置均提供 glyph URL；`Map.js` 将 Style 交给 `window.mapboxglv3.Map`。

`weixing_base.js` 使用 `https://fonts.openmaptiles.org/{fontstack}/{range}.pbf`，这是卫星样式的独立字体入口，当前未对该域名做真实请求验证。

## Sprite

| 项目 | 结果 |
| --- | --- |
| 基础 URL | `https://tiles.kye-erp.com/maptiles/styles/v3/sprite-normal` |
| JSON | HTTP 200，约 41,685 bytes |
| PNG | HTTP 200，约 82,342 bytes；尺寸 `1100 x 365` |
| 图标数量 | JSON 约 316 项（以 JSON 对象键计） |
| 元数据 | 每项包含 `x`、`y`、`width`、`height`、`pixelRatio` 等 |
| 样例名称 | `capital`、`capital_city`、`level_city`、`building`、`airport`、`hospital`、`park` |
| 使用方式 | Style symbol layer 的 `icon-image`，Mapbox GL JS 根据 sprite JSON/PNG 做 UV/纹理采样 |

当前 Style 中可见的 sprite 引用包括 `capital`/`capital_city`/`level_city`、POI `class` 动态图标、road shield 拼接名称、行政区 `dot_9` 等。完整 icon 名称应以线上 JSON 为准。

## SDK 自定义图片资产

这类图片不是 KYE Sprite，但可复用于 nova 的业务覆盖物：

- `src/mapbox/core/Marker.js`：DOM/HTML 自定义 Marker，支持 `icon`、`content`、`circle`、ripple、drag。
- `src/mapbox/core/MassMarkers.js`：通过 `map.loadImage` + `map.addImage` 注册图片，symbol layer 使用 feature 属性选择 `icon`。
- `src/mapbox/core/Vectors/Polyline.js`：箭头图片 `https://map-static.kyslb.com/bjmap/map-example/asset/arrow.png` 和 `arrow-reverse.png`。
- `src/mapbox/business/RoutePlan.js`/`TruckPlan.js`/`Platedirection.js`：起点/终点图片来自 `public/asset/start.png`、`end.png`。

## 待验证

- Sprite JSON 的内容版本、缓存头、@2x 变体（当前 URL 只验证基础 JSON/PNG）。
- Glyph PBF 的字符覆盖范围、Mapbox GL/MapLibre 版本兼容和本地字体 fallback。
- AMap 引擎是否使用同一 Sprite/Glyph；AMap 原生 LabelMarker 使用图片 URL，不读取 Mapbox sprite。
