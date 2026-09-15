# Kmap Knowledge — Data

更新日期：2026-09-12

## KYE 主瓦片协议

- KYE 主地图瓦片是 gzip 压缩 MVT/PBF，实测 MVT version 2、extent 4096，坐标为标准 Web Mercator XYZ。
- 固定 fixture `z15/26978/12416` 实时响应为 HTTP 200、`Content-Encoding: gzip`、压缩 `Content-Length: 17,909`；Fetch/curl 解压后为 35,594 bytes，SHA-256 为 `46f4ff67546c8ca229d76b5e31e4758cdf7b31588657dc9c89702aa62482202f`。
- fixture 解码结果为 water 4、landuse 39、poi_label 17、building 233、road 386、waterway 1，各 layer 为 MVT version 2、extent 4096。
- 证据：`docs/research/kye-data.md`、`docs/research/README.md`、`packages/map3d/test/fixtures/kye-main-z15-26978-12416.*`、`packages/map3d/test/decodeMvt.test.ts`。

## 解码依赖

- SDK 使用 `pbf` 5.1.2 和 `@mapbox/vector-tile` 3.0.0；两者均为 BSD-3-Clause、ESM 并内置 TypeScript 类型。
- Polygon 三角化依赖 `earcut` 3.2.3，为 ISC、ESM 并内置 TypeScript 类型。
- 独立 decoder bundle 为 15,325 bytes、gzip 4,457 bytes；Worker bundle 不包含 Three.js。
- 证据：`packages/map3d/package.json`、`pnpm-lock.yaml`、T004/T005 构建结果。

## Style 与资源

- 生产 normal Style 为 Mapbox Style v8，包含 9 个 sources、51 个 layers；Glyph 使用 Microsoft YaHei Regular；Sprite 约 316 项。
- KYE 文字资源入口已验证 Glyph PBF 模板，Microsoft YaHei Regular 的 0-255 与 256-511 范围可下载。
- 这些事实是后续 Style Compiler、文字、图标和兼容性规划输入，不代表 MVP 已支持完整 Style v8。
- 证据：`docs/research/kye-style.md`、`docs/research/kye-glyph-sprite.md`。

## 动态业务数据

- 动态业务瓦片为未压缩 MVT，属性中的 `geoBuf` 是 Base64 包装的 Geobuf PBF；样本可解码为 FeatureCollection/MultiPolygon。
- 证据：`docs/research/dynamic-mvt.md`。

## 空瓦片与 Raster

- 部分专用水系和行政区无数据瓦片会返回 HTTP 204 与空 body，不能按解析失败处理。
- KYE Raster 样本实际为 512×512 PNG，现有样式配置声明 tileSize 256；Raster 已移出 MVP。
- 证据：`docs/research/kye-data.md`、`docs/research/kye-mvt-data-dictionary.md`、`docs/research/kye-raster.md`。
